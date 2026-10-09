/**
 * LinkVault - P2P Direct Beam Engine
 *
 * What is Direct Beam?
 * Direct Beam transfers files directly between two devices using WebRTC DataChannels.
 * The file is sent browser-to-browser without ever being saved on our server!
 *
 * Key Concepts Explained:
 * 1. WebRTC (Web Real-Time Communication): Standard browser technology allowing
 *    direct peer-to-peer data streaming.
 * 2. STUN Servers (Session Traversal Utilities for NAT): Public servers (Google / Cloudflare)
 *    that help each browser discover its own external IP address and port behind home routers/Wi-Fi.
 * 3. SDP (Session Description Protocol): A text description exchanging media/data capabilities
 *    between the two browsers (Offer from Host, Answer from Receiver).
 * 4. ICE Candidates: Potential network pathways (IP and port combinations) tested to establish
 *    the most direct connection between the devices.
 * 5. Backpressure: If the local disk or Wi-Fi sends faster than the peer can receive,
 *    the sender pauses reading until the buffer empties (preventing browser crashes).
 * 6. Direct-to-Disk (File System Access API): Saves chunks directly to the hard drive as they arrive,
 *    meaning even a 10 GB file uses only ~2 MB of RAM!
 */

(function () {
  // Transfer configuration
  const CHUNK_SIZE = 64 * 1024;            // 64 Kilobytes per chunk
  const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 Megabyte threshold for backpressure flow control

  // Public Google and Cloudflare STUN servers used to discover public IP addresses
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  class BeamSession {
    /**
     * Initializes a new WebRTC Direct Beam session.
     *
     * @param {string} role - Either 'host' (sender) or 'peer' (receiver).
     * @param {string|null} roomId - Optional room identifier.
     */
    constructor(role, roomId = null) {
      this.role = role;
      this.roomId = roomId;

      // Network connections
      this.ws = null;   // WebSocket signaling connection
      this.pc = null;   // RTCPeerConnection instance
      this.dc = null;   // RTCDataChannel instance

      // State flags
      this.isAborted = false;
      this.file = null;
      this.meta = null;
      this.writableStream = null;
      this.chunksBuffer = [];
      this.bytesTransferred = 0;

      // Speed and progress tracking
      this.startTime = 0;
      this.lastSampleTime = 0;
      this.lastSampleBytes = 0;
      this.currentSpeedBps = 0;

      // Buffered ICE candidates received before remote description was set
      this.pendingCandidates = [];
      this.reconnectTimer = null;

      // UI Callbacks
      this.callbacks = {
        onReady: function () {},
        onPeerJoined: function () {},
        onMeta: function () {},
        onProgress: function () {},
        onComplete: function () {},
        onError: function () {},
        onPeerLeft: function () {},
        onStatus: function () {}
      };

      // Auto-reconnect when device screen is turned back on or app is foregrounded
      this._visibilityHandler = () => {
        const isScreenVisible = document.visibilityState === 'visible';
        const hasUnfinishedTransfer = !this.isAborted && this.bytesTransferred < (this.meta ? this.meta.size : 1);
        if (isScreenVisible && hasUnfinishedTransfer) {
          this.checkAndReconnect();
        }
      };

      document.addEventListener('visibilitychange', this._visibilityHandler);
      window.addEventListener('online', this._visibilityHandler);
      window.addEventListener('focus', this._visibilityHandler);
    }

    /**
     * Registers an event callback listener.
     *
     * @param {string} eventName - Name of the event (e.g. 'onProgress').
     * @param {Function} callback - Function to run when event occurs.
     */
    on(eventName, callback) {
      if (this.callbacks[eventName] !== undefined) {
        this.callbacks[eventName] = callback;
      }
      return this;
    }

    /**
     * Connects to the WebSocket signaling server (/ws).
     *
     * @returns {Promise<void>} Resolves when connection is open.
     */
    connectWS() {
      return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = function () {
          resolve();
        };

        this.ws.onerror = function () {
          reject(new Error('Signaling connection failed'));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleSignalingMessage(message);
          } catch (err) {
            console.error('Failed to parse signaling message:', err);
          }
        };

        this.ws.onclose = () => {
          const hasUnfinishedTransfer = !this.isAborted && this.bytesTransferred < (this.meta ? this.meta.size : 1);
          if (hasUnfinishedTransfer) {
            this.callbacks.onStatus('Connection paused (you moved away). Reconnecting...', 'paused');
            this._scheduleReconnect();
          }
        };
      });
    }

    /**
     * Checks if the WebSocket connection dropped and reconnects if necessary.
     */
    async checkAndReconnect() {
      if (this.isAborted) return;
      if (this.meta && this.bytesTransferred >= this.meta.size) return;

      const isSocketClosed = !this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING;
      if (isSocketClosed) {
        this.callbacks.onStatus('Reconnecting to server…', 'paused');
        try {
          await this.connectWS();
          if (this.roomId) {
            this.ws.send(JSON.stringify({
              type: 'reconnect',
              roomId: this.roomId,
              role: this.role
            }));
          }
        } catch (err) {
          console.warn('Reconnect failed:', err);
          this._scheduleReconnect();
        }
      }
    }

    _scheduleReconnect() {
      if (this.isAborted || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.checkAndReconnect();
      }, 2500);
    }

    /**
     * Applies any ICE candidates that arrived before setRemoteDescription finished.
     */
    async _flushCandidates() {
      while (this.pendingCandidates.length > 0) {
        const candidateData = this.pendingCandidates.shift();
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidateData));
        } catch (err) {
          console.warn('Error applying buffered ICE candidate:', err);
        }
      }
    }

    /**
     * Initializes the RTCPeerConnection object and sets up ICE candidate listeners.
     */
    initPeerConnection() {
      if (this.pc) {
        try {
          this.pc.close();
        } catch (e) {}
      }

      this.pendingCandidates = [];
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // When our browser finds an ICE candidate (network route), send it to the other peer via signaling
      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'signal',
            roomId: this.roomId,
            data: { type: 'candidate', candidate: event.candidate }
          }));
        }
      };

      // Monitor connection state
      this.pc.oniceconnectionstatechange = () => {
        const state = this.pc.iceConnectionState;
        if (state === 'failed') {
          this.callbacks.onError('Direct P2P connection failed (Symmetric NAT / Strict Firewall). Try Vault Share instead.');
        } else if (state === 'disconnected') {
          this.callbacks.onStatus('P2P connection temporarily dropped. Waiting...', 'paused');
        }
      };
    }

    /**
     * Host Flow: Start seeding a file and wait for a recipient to join.
     *
     * @param {File} file - The file object selected by the user.
     */
    async startHost(file) {
      this.file = file;
      await this.connectWS();
      this.ws.send(JSON.stringify({ type: 'create-room' }));
    }

    /**
     * Peer Flow: Join an existing room to receive a file.
     *
     * @param {string} roomId - The room ID to join.
     */
    async startPeer(roomId) {
      this.roomId = roomId;
      await this.connectWS();
      this.initPeerConnection();

      // Listen for the DataChannel opened by the host
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.setupDataChannel();
      };

      this.ws.send(JSON.stringify({ type: 'join-room', roomId: roomId }));
    }

    /**
     * Handles incoming messages from the WebSocket signaling server.
     *
     * @param {object} msg - The JSON message from the signaling server.
     */
    async handleSignalingMessage(msg) {
      switch (msg.type) {
        case 'room-created':
          this.roomId = msg.roomId;
          this.callbacks.onReady({
            roomId: this.roomId,
            beamUrl: `${window.location.origin}/beam/${this.roomId}`
          });
          break;

        case 'room-joined':
          // Recipient successfully joined room
          break;

        case 'peer-joined':
          // Recipient connected to host room: Host creates offer and DataChannel
          this.callbacks.onPeerJoined();
          this.initPeerConnection();

          // Create reliable, ordered WebRTC DataChannel
          this.dc = this.pc.createDataChannel('beamTransfer', { ordered: true });
          this.setupDataChannel();

          // Create and send SDP Offer
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.ws.send(JSON.stringify({
            type: 'signal',
            roomId: this.roomId,
            data: { type: 'offer', sdp: offer.sdp }
          }));
          break;

        case 'signal':
          if (!this.pc) return;
          const signalData = msg.data;

          if (signalData.type === 'offer') {
            // Receiver receives Offer: sets remote description and responds with Answer
            await this.pc.setRemoteDescription(new RTCSessionDescription(signalData));
            await this._flushCandidates();
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.ws.send(JSON.stringify({
              type: 'signal',
              roomId: this.roomId,
              data: { type: 'answer', sdp: answer.sdp }
            }));
          } else if (signalData.type === 'answer') {
            // Host receives Answer from Recipient
            await this.pc.setRemoteDescription(new RTCSessionDescription(signalData));
            await this._flushCandidates();
          } else if (signalData.type === 'candidate' && signalData.candidate) {
            // ICE Candidate arrived
            if (!this.pc.remoteDescription) {
              this.pendingCandidates.push(signalData.candidate);
            } else {
              try {
                await this.pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
              } catch (err) {
                console.warn('Error adding ICE candidate:', err);
              }
            }
          }
          break;

        case 'reconnected':
          this.callbacks.onStatus('Reconnected to server!', 'active');
          break;

        case 'peer-resumed':
          this.callbacks.onStatus('Peer reconnected! Resuming transfer...', 'active');
          break;

        case 'peer-disconnected':
          if (msg.transient) {
            this.callbacks.onStatus('Peer temporarily moved away. Waiting for reconnect...', 'paused');
          } else {
            this.callbacks.onPeerLeft(msg.message || 'Peer left the transfer');
          }
          break;

        case 'error':
          this.callbacks.onError(msg.message || 'Signaling error');
          break;
      }
    }

    /**
     * Sets up event listeners on the RTCDataChannel.
     */
    setupDataChannel() {
      this.dc.binaryType = 'arraybuffer';

      this.dc.onopen = () => {
        if (this.role === 'host') {
          // Send metadata header first
          const totalChunks = Math.ceil(this.file.size / CHUNK_SIZE);
          const fileId = `${this.file.name}-${this.file.size}-${this.file.lastModified}`;
          this.dc.send(JSON.stringify({
            type: 'header',
            fileId: fileId,
            name: this.file.name,
            size: this.file.size,
            mime: this.file.type || 'application/octet-stream',
            totalChunks: totalChunks
          }));
        }
      };

      this.dc.onclose = () => {
        const hasUnfinishedTransfer = !this.isAborted && this.bytesTransferred < (this.meta ? this.meta.size : 1);
        if (hasUnfinishedTransfer) {
          this.callbacks.onPeerLeft('Data channel closed unexpectedly');
        }
      };

      this.dc.onerror = () => {
        this.callbacks.onError('Data channel transfer error');
      };

      this.dc.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          // Control packet (JSON string)
          try {
            const controlPacket = JSON.parse(event.data);
            if (controlPacket.type === 'header') {
              this.meta = controlPacket;
              this.callbacks.onMeta(this.meta);
            } else if (controlPacket.type === 'start_transfer') {
              // Recipient confirmed acceptance: start sending chunks from offset
              this.sendChunks(controlPacket.startChunk || 0);
            } else if (controlPacket.type === 'eof') {
              await this.finishReceiver();
            }
          } catch (err) {
            console.error('Error handling control packet:', err);
          }
        } else {
          // Binary file chunk (ArrayBuffer)
          await this.handleIncomingChunk(event.data);
        }
      };
    }

    /**
     * Host sends the file in 64 KB slices, respecting backpressure.
     *
     * @param {number} startChunkIndex - Chunk index to start from (supports resume).
     */
    sendChunks(startChunkIndex = 0) {
      let currentChunk = startChunkIndex;
      let byteOffset = currentChunk * CHUNK_SIZE;
      const totalSize = this.file.size;

      this.startTime = Date.now();
      this.lastSampleTime = this.startTime;
      this.lastSampleBytes = 0;

      const pump = () => {
        if (this.isAborted) return;

        while (byteOffset < totalSize) {
          // Backpressure check: if more than 1 MB is waiting in the browser buffer, pause!
          if (this.dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            this.dc.onbufferedamountlow = () => {
              this.dc.onbufferedamountlow = null;
              pump(); // Resume reading when buffer has drained
            };
            return;
          }

          const fileSlice = this.file.slice(byteOffset, byteOffset + CHUNK_SIZE);
          const reader = new FileReader();

          reader.onload = () => {
            if (this.isAborted) return;
            try {
              this.dc.send(reader.result);
              byteOffset += fileSlice.size;
              this.bytesTransferred = byteOffset;
              currentChunk++;

              this.updateMetrics(this.bytesTransferred, totalSize);

              if (byteOffset >= totalSize) {
                // All bytes sent: send EOF packet
                this.dc.send(JSON.stringify({ type: 'eof' }));
                this.callbacks.onComplete();
              } else {
                pump();
              }
            } catch (err) {
              this.callbacks.onError('Error sending chunk over DataChannel');
            }
          };

          reader.readAsArrayBuffer(fileSlice);
          return; // Wait for FileReader callback
        }
      };

      pump();
    }

    /**
     * Recipient accepts the transfer: requests file save handle and informs host.
     *
     * @returns {Promise<boolean>} True if accepted, false if user cancelled.
     */
    async acceptTransfer() {
      if (!this.meta) return false;

      this.startTime = Date.now();
      this.lastSampleTime = this.startTime;
      this.lastSampleBytes = 0;
      this.bytesTransferred = 0;
      this.chunksBuffer = [];

      let startChunk = 0;
      if (window.LinkVaultCache) {
        const resumeInfo = await window.LinkVaultCache.getResumeRecord(this.meta.fileId);
        if (resumeInfo && resumeInfo.lastContiguousChunk > 0) {
          startChunk = resumeInfo.lastContiguousChunk + 1;
        }
      }

      // If browser supports Direct-to-Disk (Chrome, Edge, Opera)
      if (window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: this.meta.name
          });
          this.writableStream = await fileHandle.createWritable();
          if (startChunk > 0) {
            await this.writableStream.seek(startChunk * CHUNK_SIZE);
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            return false; // User cancelled file picker modal
          }
          console.warn('showSaveFilePicker failed, falling back to memory buffer:', err);
        }
      }

      // Tell host to start transmission
      this.dc.send(JSON.stringify({
        type: 'start_transfer',
        startChunk: startChunk
      }));

      return true;
    }

    /**
     * Writes incoming chunk directly to disk or in-memory array.
     *
     * @param {ArrayBuffer} arrayBuffer - Incoming binary chunk.
     */
    async handleIncomingChunk(arrayBuffer) {
      this.bytesTransferred += arrayBuffer.byteLength;

      if (this.writableStream) {
        // Direct-to-Disk: RAM usage stays flat at ~2 MB!
        await this.writableStream.write(arrayBuffer);
      } else {
        // Fallback: collect in memory
        this.chunksBuffer.push(arrayBuffer);
      }

      const currentChunk = Math.floor(this.bytesTransferred / CHUNK_SIZE);
      if (window.LinkVaultCache && this.meta) {
        window.LinkVaultCache.saveResumeRecord(this.meta.fileId, currentChunk, this.meta.totalChunks);
      }

      this.updateMetrics(this.bytesTransferred, this.meta.size);
    }

    /**
     * Finalizes the downloaded file on the receiver side.
     */
    async finishReceiver() {
      if (this.writableStream) {
        await this.writableStream.close();
        this.writableStream = null;
      } else if (this.chunksBuffer.length > 0) {
        // Combine in-memory chunks into a single Blob and trigger browser download
        const blob = new Blob(this.chunksBuffer, { type: this.meta.mime });
        const downloadUrl = URL.createObjectURL(blob);
        const linkElement = document.createElement('a');
        linkElement.href = downloadUrl;
        linkElement.download = this.meta.name;
        document.body.appendChild(linkElement);
        linkElement.click();

        setTimeout(() => {
          URL.revokeObjectURL(downloadUrl);
          linkElement.remove();
        }, 1000);
      }

      if (window.LinkVaultCache && this.meta) {
        window.LinkVaultCache.clearResumeRecord(this.meta.fileId);
      }

      this.callbacks.onComplete();
    }

    /**
     * Calculates transfer speed (bytes per second) and estimated time remaining (ETA).
     */
    updateMetrics(transferredBytes, totalBytes) {
      const now = Date.now();
      const secondsElapsed = (now - this.lastSampleTime) / 1000;

      // Update speed calculation twice per second
      if (secondsElapsed >= 0.5) {
        const bytesDelta = transferredBytes - this.lastSampleBytes;
        this.currentSpeedBps = bytesDelta / secondsElapsed;
        this.lastSampleTime = now;
        this.lastSampleBytes = transferredBytes;
      }

      const percent = totalBytes > 0 ? Math.min(100, (transferredBytes / totalBytes) * 100) : 0;
      const remainingBytes = Math.max(0, totalBytes - transferredBytes);
      const etaSeconds = this.currentSpeedBps > 0 ? Math.ceil(remainingBytes / this.currentSpeedBps) : 0;

      this.callbacks.onProgress({
        transferred: transferredBytes,
        total: totalBytes,
        percent: percent,
        speedBps: this.currentSpeedBps,
        etaSeconds: etaSeconds
      });
    }

    /**
     * Aborts the session and closes all active network connections.
     */
    abort() {
      this.isAborted = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      window.removeEventListener('online', this._visibilityHandler);
      window.removeEventListener('focus', this._visibilityHandler);

      if (this.dc) this.dc.close();
      if (this.pc) this.pc.close();
      if (this.ws) this.ws.close();
      if (this.writableStream) {
        try { this.writableStream.abort(); } catch (e) {}
      }
    }
  }

  // Expose BeamSession on global window
  window.BeamSession = BeamSession;
})();
