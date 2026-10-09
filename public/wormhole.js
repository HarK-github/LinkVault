/**
 * LinkVault - Magic Wormhole Engine
 *
 * What is the Magic Wormhole?
 * The Magic Wormhole allows two people to securely transfer a file across the internet
 * using only a simple, human-friendly 3-word passphrase (like "swift-42-river").
 *
 * How the Cryptography Works (Step-by-Step):
 * 1. Passphrase Generation:
 *    The sender picks a random adjective, number, and noun (e.g. "swift-42-river").
 * 2. Room Rendezvous (PBKDF2):
 *    Both sender and receiver run PBKDF2 (50,000 iterations of SHA-256) on the passphrase
 *    to generate a 128-bit Room ID. The signaling server uses this ID to connect the two peers.
 * 3. Key Exchange (ECDH P-256):
 *    Both devices generate temporary Elliptic-Curve Diffie-Hellman (ECDH) keypairs.
 *    They trade public keys through the server.
 * 4. Shared Symmetric Key (AES-256-GCM):
 *    Combining Device A's private key with Device B's public key mathematically produces
 *    the EXACT same 256-bit secret key on both devices!
 *    The server only saw public keys and never learns this shared secret key.
 * 5. End-to-End Encryption:
 *    Every 64 KB chunk of the file is encrypted with AES-256-GCM before transmission.
 * 6. Dual-Mode Transport:
 *    Tries direct peer-to-peer WebRTC first. If blocked by a strict firewall or mobile NAT,
 *    it seamlessly falls back to Encrypted Blind Relay over WebSockets. In Blind Relay mode,
 *    the server only forwards scrambled ciphertext that it cannot decrypt.
 */

(function () {
  // Constants & Parameters
  const PBKDF2_ITERATIONS = 50000;   // 50,000 rounds of key stretching
  const CHUNK_SIZE = 64 * 1024;      // 64 Kilobytes per file chunk
  const IV_LENGTH_BYTES = 12;        // 12-byte random initialization vector for AES-GCM
  const MAX_BUFFER_BYTES = 1024 * 1024; // 1 MB backpressure threshold

  // Message tags to distinguish control commands from file chunks
  const TAG_CONTROL = 1;
  const TAG_DATA = 2;

  // Text encoder/decoder for converting strings to/from binary bytes
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // Fixed salt used for PBKDF2 room ID generation
  const SALT = textEncoder.encode('linkvault-wormhole-v1');

  // Public STUN servers for WebRTC peer discovery
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  // ============================================================================
  // CRYPTOGRAPHIC & HEX HELPERS
  // ============================================================================

  // Lookup table for fast byte-to-hex conversion (e.g. 255 -> "ff")
  const HEX_TABLE = [];
  for (let i = 0; i < 256; i++) {
    HEX_TABLE[i] = i.toString(16).padStart(2, '0');
  }

  /**
   * Converts an ArrayBuffer to a hexadecimal string.
   *
   * @param {ArrayBuffer} buffer - Binary data buffer.
   * @returns {string} Hex string (e.g. "4a7f...").
   */
  function bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hexString = '';
    for (let i = 0; i < bytes.length; i++) {
      hexString += HEX_TABLE[bytes[i]];
    }
    return hexString;
  }

  /**
   * Converts a hexadecimal string back into an ArrayBuffer.
   *
   * @param {string} hex - Hexadecimal string.
   * @returns {ArrayBuffer} Binary data buffer.
   */
  function hexToBuffer(hex) {
    const byteLength = hex.length / 2;
    const uint8Array = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      const hexByte = hex.substr(i * 2, 2);
      uint8Array[i] = parseInt(hexByte, 16);
    }
    return uint8Array.buffer;
  }

  /**
   * Derives a 128-bit hexadecimal room ID from a human passphrase using PBKDF2.
   *
   * @param {string} passphrase - The passphrase (e.g. "swift-42-river").
   * @returns {Promise<string>} Hexadecimal room ID.
   */
  async function passphraseToRoomId(passphrase) {
    const normalized = passphrase.toLowerCase().trim();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(normalized),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: SALT,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      128 // 128 bits = 16 bytes = 32 hex chars
    );

    return bufferToHex(derivedBits);
  }

  /**
   * Generates a random, friendly 3-word passphrase (e.g. "swift-42-river").
   *
   * @returns {string} Friendly passphrase.
   */
  function generatePassphrase() {
    const adjectives = (typeof window !== 'undefined' && window.WH_ADJ) ? window.WH_ADJ : [];
    const nouns = (typeof window !== 'undefined' && window.WH_NOUN) ? window.WH_NOUN : [];

    // Get 3 random cryptographically secure bytes
    const randomBytes = crypto.getRandomValues(new Uint8Array(3));

    const selectedAdj = adjectives[randomBytes[0] % adjectives.length] || 'swift';
    const selectedNum = randomBytes[1] % 100; // 0 to 99
    const selectedNoun = nouns[randomBytes[2] % nouns.length] || 'river';

    return `${selectedAdj}-${selectedNum}-${selectedNoun}`;
  }

  /**
   * Generates a temporary ECDH P-256 keypair for Diffie-Hellman key exchange.
   *
   * @returns {Promise<CryptoKeyPair>} Generated ECDH keypair.
   */
  async function generateECDHKeypair() {
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true, // extractable
      ['deriveBits']
    );
  }

  /**
   * Exports an ECDH public key to a hexadecimal string for transmission.
   *
   * @param {CryptoKey} key - ECDH public key.
   * @returns {Promise<string>} Hex representation of raw public key.
   */
  async function exportPublicKeyToHex(key) {
    const rawBuffer = await crypto.subtle.exportKey('raw', key);
    return bufferToHex(rawBuffer);
  }

  /**
   * Imports a hexadecimal string back into a usable ECDH public CryptoKey.
   *
   * @param {string} hex - Hex string of public key.
   * @returns {Promise<CryptoKey>} ECDH public key.
   */
  async function importPublicKeyFromHex(hex) {
    const rawBuffer = hexToBuffer(hex);
    return crypto.subtle.importKey(
      'raw',
      rawBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
  }

  /**
   * Derives a 256-bit AES-GCM encryption key from our private key and the peer's public key.
   *
   * @param {CryptoKey} ourPrivateKey - Local private ECDH key.
   * @param {CryptoKey} peerPublicKey - Remote peer's public ECDH key.
   * @returns {Promise<CryptoKey>} Shared AES-GCM encryption key.
   */
  async function deriveSharedAESKey(ourPrivateKey, peerPublicKey) {
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey },
      ourPrivateKey,
      256
    );

    return crypto.subtle.importKey(
      'raw',
      sharedBits,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts a message or binary chunk using AES-256-GCM.
   * Formats output as: [1 byte Tag] + [12 bytes IV] + [Ciphertext + Auth Tag]
   *
   * @param {CryptoKey} aesKey - The shared AES-256-GCM key.
   * @param {number} tag - Message type tag (TAG_CONTROL or TAG_DATA).
   * @param {string|ArrayBuffer} payload - Data to encrypt.
   * @returns {Promise<ArrayBuffer>} Encrypted binary buffer.
   */
  async function encryptMessage(aesKey, tag, payload) {
    // Generate fresh random 12-byte IV for every single message
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

    let dataBuffer;
    if (payload instanceof ArrayBuffer) {
      dataBuffer = payload;
    } else {
      dataBuffer = textEncoder.encode(payload).buffer;
    }

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      dataBuffer
    );

    // Pack into output buffer: tag (1 byte) + IV (12 bytes) + ciphertext
    const totalLength = 1 + IV_LENGTH_BYTES + ciphertext.byteLength;
    const output = new Uint8Array(totalLength);
    output[0] = tag;
    output.set(iv, 1);
    output.set(new Uint8Array(ciphertext), 1 + IV_LENGTH_BYTES);

    return output.buffer;
  }

  /**
   * Decrypts an encrypted message buffer using AES-256-GCM.
   *
   * @param {CryptoKey} aesKey - The shared AES-256-GCM key.
   * @param {ArrayBuffer} encryptedBuffer - Raw received binary buffer.
   * @returns {Promise<{ tag: number, plain: ArrayBuffer }>} Decrypted payload and tag.
   */
  async function decryptMessage(aesKey, encryptedBuffer) {
    const bytes = new Uint8Array(encryptedBuffer);
    const tag = bytes[0];
    const iv = bytes.slice(1, 1 + IV_LENGTH_BYTES);
    const ciphertext = bytes.slice(1 + IV_LENGTH_BYTES);

    const decryptedPlain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      ciphertext
    );

    return { tag: tag, plain: decryptedPlain };
  }

  // ============================================================================
  // WORMHOLE SESSION CLASS
  // ============================================================================

  class WormholeSession {
    /**
     * Initializes a new Wormhole transfer session.
     *
     * @param {string} role - Either 'sender' or 'receiver'.
     */
    constructor(role) {
      this.role = role;

      // Sockets & WebRTC
      this.ws = null;
      this.pc = null;
      this.dc = null;

      // Cryptography keys
      this.keypair = null;
      this.peerPublicKeyHex = null;
      this.aesKey = null;

      // Room & file state
      this.roomId = null;
      this.phrase = null;
      this.file = null;
      this.meta = null;

      // Stream writing & buffering
      this.writableStream = null;
      this.chunks = [];
      this.bytesTransferred = 0;

      // Metrics
      this.startTime = 0;
      this.lastSampleTime = 0;
      this.lastSampleBytes = 0;
      this.speed = 0;

      // Session flags
      this.isCompleted = false;
      this.isAborted = false;
      this.useRelayFallback = false;
      this.transferStarted = false;
      this.completedBlobUrl = null;

      // Buffered network signals
      this.pendingCandidates = [];
      this.pendingSignals = [];
      this.reconnectTimer = null;

      // UI Callbacks
      this.callbacks = {
        onPassphrase: function () {},
        onDeriving: function () {},
        onReady: function () {},
        onPeerJoined: function () {},
        onMeta: function () {},
        onProgress: function () {},
        onComplete: function () {},
        onError: function () {},
        onPeerLeft: function () {},
        onStatus: function () {}
      };

      // Auto-reconnect when device returns to foreground
      this._visibilityHandler = () => {
        const isScreenVisible = document.visibilityState === 'visible';
        if (isScreenVisible && !this.isCompleted && !this.isAborted) {
          this.checkAndReconnect();
        }
      };

      document.addEventListener('visibilitychange', this._visibilityHandler);
      window.addEventListener('online', this._visibilityHandler);
      window.addEventListener('focus', this._visibilityHandler);
    }

    /**
     * Registers an event callback listener.
     */
    on(event, callback) {
      if (this.callbacks[event] !== undefined) {
        this.callbacks[event] = callback;
      }
      return this;
    }

    // ==========================================================================
    // PUBLIC CONTROL METHODS
    // ==========================================================================

    /**
     * Sender workflow: generates passphrase, derives room ID, connects to server.
     *
     * @param {File} file - Selected file to send.
     */
    async startSender(file) {
      this.file = file;
      this.phrase = generatePassphrase();
      this.callbacks.onPassphrase(this.phrase);

      await this._setup(this.phrase);
      await this._registerHost();
    }

    /**
     * Receiver workflow: accepts passphrase, derives room ID, connects to server.
     *
     * @param {string} passphrase - Passphrase typed by recipient.
     */
    async startReceiver(passphrase) {
      this.phrase = passphrase.trim();
      await this._setup(this.phrase);
      await this._registerPeer();
    }

    /**
     * Common setup: derives room ID and creates ephemeral ECDH keypair.
     */
    async _setup(passphrase) {
      this.callbacks.onDeriving();
      this.roomId = await passphraseToRoomId(passphrase);
      this.keypair = await generateECDHKeypair();
      await this._connectWS();
    }

    /**
     * Registers sender with signaling server.
     */
    async _registerHost() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const publicKeyHex = await exportPublicKeyToHex(this.keypair.publicKey);
      this.ws.send(JSON.stringify({
        type: 'wh-open',
        roomId: this.roomId,
        pubkey: publicKeyHex
      }));
    }

    /**
     * Registers receiver with signaling server.
     */
    async _registerPeer() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const publicKeyHex = await exportPublicKeyToHex(this.keypair.publicKey);
      this.ws.send(JSON.stringify({
        type: 'wh-join',
        roomId: this.roomId,
        pubkey: publicKeyHex
      }));
    }

    /**
     * Reconnects to signaling server if socket dropped.
     */
    async checkAndReconnect() {
      if (this.isCompleted || this.isAborted) return;

      const isSocketClosed = !this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING;
      if (isSocketClosed) {
        this.callbacks.onStatus('Reconnecting to server…', 'paused');
        try {
          await this._connectWS();
          if (this.role === 'sender') {
            await this._registerHost();
          } else {
            await this._registerPeer();
          }
          this.callbacks.onStatus('Reconnected! Waiting for peer…', 'active');
        } catch (err) {
          console.warn('Reconnect failed:', err);
          this._scheduleReconnect();
        }
      }
    }

    _scheduleReconnect() {
      if (this.isCompleted || this.isAborted || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.checkAndReconnect();
      }, 2000);
    }

    /**
     * Receiver confirms acceptance and prompts for save location.
     */
    async acceptTransfer() {
      if (!this.meta) return false;

      this.bytesTransferred = 0;
      this.startTime = Date.now();
      this.lastSampleTime = this.startTime;
      this.lastSampleBytes = 0;
      this.chunks = [];

      // Check for Direct-to-Disk capability
      if (window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: this.meta.name
          });
          this.writableStream = await fileHandle.createWritable();
        } catch (err) {
          if (err.name === 'AbortError') return false; // User cancelled modal
          console.warn('showSaveFilePicker unavailable, using memory fallback');
        }
      }

      // Send encrypted start command to sender
      await this._sendMessage(TAG_CONTROL, JSON.stringify({ type: 'start', offset: 0 }));
      return true;
    }

    /**
     * Aborts transfer and closes all network sockets.
     */
    abort() {
      this.isAborted = true;
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      window.removeEventListener('online', this._visibilityHandler);
      window.removeEventListener('focus', this._visibilityHandler);

      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

      if (this.dc) { try { this.dc.close(); } catch (e) {} }
      if (this.pc) { try { this.pc.close(); } catch (e) {} }
      if (this.ws) { try { this.ws.close(); } catch (e) {} }
      if (this.writableStream) { try { this.writableStream.abort(); } catch (e) {} }
    }

    // ==========================================================================
    // INTERNAL NETWORKING & WEBRTC
    // ==========================================================================

    _connectWS() {
      return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        this.ws.onopen = () => resolve();
        this.ws.onerror = () => reject(new Error('Signaling connection failed'));

        this.ws.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            await this._handleSignalingMessage(message);
          } catch (err) {
            console.error('Signaling message error:', err);
          }
        };

        this.ws.onclose = () => {
          if (!this.isCompleted && !this.isAborted) {
            this.callbacks.onStatus('Connection paused (you moved away). Reconnecting…', 'paused');
            this._scheduleReconnect();
          }
        };
      });
    }

    async _handleSignalingMessage(msg) {
      const { type, pubkey, data } = msg;

      switch (type) {
        case 'wh-ready':
          this.callbacks.onReady();
          break;

        case 'wh-peer-joined':
          // Recipient joined: derive shared AES key from their public key
          this.peerPublicKeyHex = pubkey;
          const peerPublicKey = await importPublicKeyFromHex(pubkey);
          this.aesKey = await deriveSharedAESKey(this.keypair.privateKey, peerPublicKey);
          this.callbacks.onPeerJoined();
          await this._startRTCSender();
          break;

        case 'wh-joined':
          // Joined sender's room: derive shared AES key from sender's public key
          this.peerPublicKeyHex = pubkey;
          const senderPublicKey = await importPublicKeyFromHex(pubkey);
          this.aesKey = await deriveSharedAESKey(this.keypair.privateKey, senderPublicKey);
          await this._startRTCReceiver();
          break;

        case 'wh-signal':
          await this._handleRTCSignal(data);
          break;

        case 'wh-chunk':
          // Blind relay fallback: decrypt chunk received via WebSocket
          await this._handleRelayChunk(data);
          break;

        case 'peer-resumed':
          this.callbacks.onStatus('Peer reconnected!', 'active');
          break;

        case 'peer-disconnected':
          if (msg.transient) {
            this.callbacks.onStatus('Peer moved away or backgrounded app. Waiting for them to return…', 'paused');
          } else {
            this.callbacks.onPeerLeft(msg.message || 'Peer disconnected');
          }
          break;

        case 'error':
          this.callbacks.onError(msg.message || 'Signaling error');
          break;
      }
    }

    _relaySignal(signalData) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'wh-signal',
          roomId: this.roomId,
          data: signalData
        }));
      }
    }

    _createRTCPeerConnection() {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._relaySignal({ type: 'candidate', candidate: event.candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          console.warn('WebRTC P2P direct connection blocked; enabling Encrypted Blind Relay fallback');
          this.useRelayFallback = true;
        } else if (pc.iceConnectionState === 'disconnected') {
          this.callbacks.onStatus('P2P connection temporarily dropped', 'paused');
        }
      };

      return pc;
    }

    async _flushCandidates() {
      while (this.pendingCandidates.length > 0) {
        const candidate = this.pendingCandidates.shift();
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Error applying candidate:', err);
        }
      }
    }

    async _flushSignals() {
      while (this.pendingSignals.length > 0) {
        const signal = this.pendingSignals.shift();
        await this._handleRTCSignal(signal);
      }
    }

    async _handleRTCSignal(signal) {
      if (!this.pc) {
        this.pendingSignals.push(signal);
        return;
      }

      const { type, sdp, candidate } = signal;

      if (type === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp }));
        await this._flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this._relaySignal({ type: 'answer', sdp: answer.sdp });
      } else if (type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdp }));
        await this._flushCandidates();
      } else if (type === 'candidate' && candidate) {
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(candidate);
        } else {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('Error adding ICE candidate:', err);
          }
        }
      }
    }

    async _startRTCSender() {
      if (this.pc) { try { this.pc.close(); } catch (e) {} }
      if (this.dc) { try { this.dc.close(); } catch (e) {} }

      this.pendingCandidates = [];
      this.headerSent = false;
      this.transferStarted = false;

      this.pc = this._createRTCPeerConnection();
      this.dc = this.pc.createDataChannel('wh', { ordered: true });
      this.dc.binaryType = 'arraybuffer';

      const sendHeaderPacket = async () => {
        if (this.headerSent) return;
        this.headerSent = true;

        const headerInfo = {
          type: 'header',
          name: this.file.name,
          size: this.file.size,
          mime: this.file.type || 'application/octet-stream',
          totalChunks: Math.ceil(this.file.size / CHUNK_SIZE)
        };

        await this._sendMessage(TAG_CONTROL, JSON.stringify(headerInfo));
      };

      this.dc.onopen = () => {
        sendHeaderPacket();
      };

      this.dc.onclose = () => {
        if (!this.isCompleted && !this.useRelayFallback) {
          this.useRelayFallback = true;
        }
      };

      this.dc.onmessage = async (event) => {
        try {
          const { tag, plain } = await decryptMessage(this.aesKey, event.data);
          if (tag === TAG_CONTROL) {
            const controlMessage = JSON.parse(textDecoder.decode(plain));
            if (controlMessage.type === 'start') {
              this._pumpFileChunks(controlMessage.offset || 0);
            }
          }
        } catch (err) {
          console.error('Decrypt error on sender:', err);
        }
      };

      await this._flushSignals();

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this._relaySignal({ type: 'offer', sdp: offer.sdp });

      // If WebRTC DataChannel doesn't connect within 4 seconds, fall back to Blind Relay
      setTimeout(() => {
        if (!this.dc || this.dc.readyState !== 'open') {
          console.info('P2P DataChannel not open after 4s; enabling Blind Relay fallback');
          this.useRelayFallback = true;
          sendHeaderPacket();
        }
      }, 4000);
    }

    async _startRTCReceiver() {
      if (this.pc) { try { this.pc.close(); } catch (e) {} }
      if (this.dc) { try { this.dc.close(); } catch (e) {} }

      this.pendingCandidates = [];
      this.pc = this._createRTCPeerConnection();

      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.dc.binaryType = 'arraybuffer';

        this.dc.onclose = () => {
          if (!this.isCompleted && !this.useRelayFallback) {
            this.useRelayFallback = true;
          }
        };

        this.dc.onmessage = async (msgEvent) => {
          try {
            const { tag, plain } = await decryptMessage(this.aesKey, msgEvent.data);
            if (tag === TAG_CONTROL) {
              const controlMessage = JSON.parse(textDecoder.decode(plain));
              if (controlMessage.type === 'header') {
                this.meta = controlMessage;
                this.callbacks.onMeta(controlMessage);
              } else if (controlMessage.type === 'eof') {
                await this._finalizeReceivedFile();
              }
            } else if (tag === TAG_DATA) {
              await this._writeChunk(plain);
            }
          } catch (err) {
            console.error('Decrypt error on receiver:', err);
          }
        };
      };

      await this._flushSignals();
    }

    /**
     * Sends an encrypted packet via direct DataChannel or Blind Relay WebSocket.
     */
    async _sendMessage(tag, payload) {
      const encryptedBuffer = await encryptMessage(this.aesKey, tag, payload);

      if (this.dc && this.dc.readyState === 'open' && !this.useRelayFallback) {
        // Direct WebRTC DataChannel
        this.dc.send(encryptedBuffer);
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Blind Relay via WebSocket (server sees only hex ciphertext)
        this.ws.send(JSON.stringify({
          type: 'wh-chunk',
          roomId: this.roomId,
          data: bufferToHex(encryptedBuffer)
        }));
      }
    }

    async _handleRelayChunk(hexCiphertext) {
      this.useRelayFallback = true;
      try {
        const rawBuffer = hexToBuffer(hexCiphertext);
        const { tag, plain } = await decryptMessage(this.aesKey, rawBuffer);

        if (tag === TAG_CONTROL) {
          const controlMessage = JSON.parse(textDecoder.decode(plain));
          if (controlMessage.type === 'header') {
            this.meta = controlMessage;
            this.callbacks.onMeta(controlMessage);
          } else if (controlMessage.type === 'start') {
            this._pumpFileChunks(controlMessage.offset || 0);
          } else if (controlMessage.type === 'eof') {
            await this._finalizeReceivedFile();
          }
        } else if (tag === TAG_DATA) {
          await this._writeChunk(plain);
        }
      } catch (err) {
        console.error('Relay decrypt error:', err);
      }
    }

    // ==========================================================================
    // DATA STREAMING & CHUNKING
    // ==========================================================================

    _pumpFileChunks(startOffset = 0) {
      if (this.transferStarted) return;
      this.transferStarted = true;

      let byteOffset = startOffset;
      const totalBytes = this.file.size;

      this.startTime = Date.now();
      this.lastSampleTime = this.startTime;
      this.lastSampleBytes = 0;

      const sendNextChunk = async () => {
        if (this.isAborted) return;

        while (byteOffset < totalBytes) {
          // Check DataChannel backpressure
          if (this.dc && this.dc.readyState === 'open' && !this.useRelayFallback && this.dc.bufferedAmount > MAX_BUFFER_BYTES) {
            this.dc.onbufferedamountlow = () => {
              this.dc.onbufferedamountlow = null;
              sendNextChunk();
            };
            return;
          }

          // Check WebSocket backpressure if using Blind Relay
          if (this.useRelayFallback && this.ws && this.ws.bufferedAmount > 256 * 1024) {
            while (this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount > 64 * 1024) {
              await new Promise((r) => setTimeout(r, 15));
            }
          }

          // Read 64 KB slice from disk/file
          const sliceBlob = this.file.slice(byteOffset, byteOffset + CHUNK_SIZE);
          const sliceBuffer = await sliceBlob.arrayBuffer();

          // Encrypt and send
          await this._sendMessage(TAG_DATA, sliceBuffer);
          byteOffset += sliceBuffer.byteLength;
          this.bytesTransferred = byteOffset;
          this._updateTransferMetrics(byteOffset, totalBytes);

          if (byteOffset >= totalBytes) {
            this.isCompleted = true;
            await this._sendMessage(TAG_CONTROL, JSON.stringify({ type: 'eof' }));
            this.callbacks.onComplete({ name: this.file.name, size: this.file.size });
            return;
          }

          if (this.useRelayFallback) {
            // Small 4ms pause for smooth relay flow
            await new Promise((r) => setTimeout(r, 4));
          }
        }
      };

      sendNextChunk();
    }

    async _writeChunk(plainBuffer) {
      this.bytesTransferred += plainBuffer.byteLength;

      if (this.writableStream) {
        // Direct-to-Disk write: RAM stays low
        await this.writableStream.write(plainBuffer);
      } else {
        // In-memory fallback
        this.chunks.push(plainBuffer.slice(0));
      }

      this._updateTransferMetrics(this.bytesTransferred, this.meta.size);
    }

    async _finalizeReceivedFile() {
      this.isCompleted = true;
      let downloadUrl = null;

      if (this.writableStream) {
        try {
          await this.writableStream.close();
        } catch (err) {
          console.warn('Writable close error:', err);
        }
        this.writableStream = null;
      } else if (this.chunks.length > 0) {
        // Assemble Blob and trigger browser download
        const fileType = this.meta ? this.meta.mime : 'application/octet-stream';
        const fileBlob = new Blob(this.chunks, { type: fileType });
        downloadUrl = URL.createObjectURL(fileBlob);
        this.completedBlobUrl = downloadUrl;

        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = this.meta ? this.meta.name : 'downloaded_file';
        document.body.appendChild(downloadLink);

        try {
          downloadLink.click();
        } catch (err) {
          console.warn('Auto download click failed:', err);
        }

        setTimeout(() => {
          downloadLink.remove();
        }, 2000);
      }

      this.callbacks.onComplete({
        downloadUrl: downloadUrl,
        name: this.meta ? this.meta.name : 'file',
        size: this.meta ? this.meta.size : this.bytesTransferred
      });
    }

    _updateTransferMetrics(transferred, total) {
      const now = Date.now();
      const elapsedSeconds = (now - this.lastSampleTime) / 1000;

      if (elapsedSeconds >= 0.5) {
        this.speed = (transferred - this.lastSampleBytes) / elapsedSeconds;
        this.lastSampleTime = now;
        this.lastSampleBytes = transferred;
      }

      const percent = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
      const etaSeconds = this.speed > 0 ? Math.ceil((total - transferred) / this.speed) : 0;

      this.callbacks.onProgress({
        transferred: transferred,
        total: total,
        percent: percent,
        speedBps: this.speed,
        etaSeconds: etaSeconds
      });
    }
  }

  // Expose on global window object
  window.WormholeSession = WormholeSession;
  window.WH = {
    generatePassphrase: generatePassphrase,
    passphraseToRoomId: passphraseToRoomId
  };
})();
