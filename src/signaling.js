/**
 * LinkVault - WebSocket Signaling Server (WebRTC Direct Beam & Wormhole)
 *
 * What is a Signaling Server?
 * In WebRTC peer-to-peer transfers, two browsers communicate directly with each other.
 * However, before they can connect, they need a temporary intermediary (the signaling server)
 * to introduce them and exchange connection coordinates:
 * 1. SDP (Session Description Protocol) offers & answers (codecs, capabilities).
 * 2. ICE Candidates (IP addresses and ports discovered via STUN servers).
 * 3. Wormhole Public Keys: ECDH public keys so both sides can derive the same AES key
 *    without the server ever knowing the shared encryption secret.
 *
 * Once the handshake is complete, file data flows directly between browsers (or via
 * encrypted blind relay if symmetric NAT/firewalls block direct UDP traffic).
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// In-memory active room registry:
// Map<roomId, { id, hostWs, peerWs, createdAt, timeoutId, hostGraceTimer, peerGraceTimer, ... }>
const rooms = new Map();

// If a room is created but no second peer joins within 5 minutes, auto-clean it
const UNJOINED_ROOM_TTL_MS = 5 * 60 * 1000;

// Keep-alive ping interval to prevent cloud reverse proxies (Render, Cloudflare) from closing idle sockets
const PING_INTERVAL_MS = 30 * 1000;

// Grace period for mobile devices switching apps or screen locking:
// In test environments, set to 0 so unit tests execute without waiting.
const DISCONNECT_GRACE_MS = process.env.NODE_ENV === 'test' ? 0 : 60 * 1000;

/**
 * Generates a cryptographically strong 16-hex-character room ID (8 random bytes).
 *
 * @returns {string} Unique room ID (e.g. "a3f81b2c4e5d6f70")
 */
function generateRoomId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Safely sends a JSON payload to a WebSocket client if its connection is still open.
 *
 * @param {object} ws - WebSocket client connection.
 * @param {object} payload - JavaScript object to serialize and send.
 */
function safeSend(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to send WebSocket message:', err.message);
    }
  }
}

/**
 * Completely closes a room, cancels all active timers, notifies remaining peers,
 * and removes the room from the active rooms map.
 *
 * @param {string} roomId - The ID of the room to destroy.
 * @param {string} [reason='Room closed'] - Human-readable reason for closure.
 */
function destroyRoom(roomId, reason = 'Room closed') {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  // Clear any pending timeout or grace timers
  if (room.timeoutId) {
    clearTimeout(room.timeoutId);
  }
  if (room.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer);
  }
  if (room.peerGraceTimer) {
    clearTimeout(room.peerGraceTimer);
  }

  // Notify any remaining connected participants
  const disconnectNotice = { type: 'peer-disconnected', message: reason };
  if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
    safeSend(room.hostWs, disconnectNotice);
  }
  if (room.peerWs && room.peerWs.readyState === room.peerWs.OPEN) {
    safeSend(room.peerWs, disconnectNotice);
  }

  rooms.delete(roomId);
}

/**
 * Handles a peer disconnecting, supporting transient mobile app-switching grace periods.
 * If DISCONNECT_GRACE_MS is enabled, gives the user 60 seconds to return before destroying the room.
 *
 * @param {object} ws - The disconnected WebSocket instance.
 * @param {string} reason - Disconnect explanation.
 */
function handlePeerDisconnect(ws, reason) {
  const roomId = ws.activeRoomId;
  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);

  // If grace period is 0 (test environment), immediately destroy room
  if (DISCONNECT_GRACE_MS === 0) {
    destroyRoom(roomId, reason);
    return;
  }

  // If host disconnected
  if (ws === room.hostWs) {
    room.hostWs = null;
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
    }

    if (room.peerWs && room.peerWs.readyState === room.peerWs.OPEN) {
      safeSend(room.peerWs, {
        type: 'peer-disconnected',
        message: 'Sender moved away or backgrounded app. Waiting up to 60s for reconnect...',
        transient: true
      });
    }

    room.hostGraceTimer = setTimeout(() => {
      if (rooms.has(roomId) && !room.hostWs) {
        destroyRoom(roomId, 'Sender did not reconnect within grace period');
      }
    }, DISCONNECT_GRACE_MS);
  } else if (ws === room.peerWs) {
    // If peer (receiver) disconnected
    room.peerWs = null;
    if (room.peerGraceTimer) {
      clearTimeout(room.peerGraceTimer);
    }

    if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
      safeSend(room.hostWs, {
        type: 'peer-disconnected',
        message: 'Recipient moved away or backgrounded app. Waiting up to 60s for reconnect...',
        transient: true
      });
    }

    room.peerGraceTimer = setTimeout(() => {
      if (rooms.has(roomId) && !room.peerWs) {
        destroyRoom(roomId, 'Recipient did not reconnect within grace period');
      }
    }, DISCONNECT_GRACE_MS);
  }
}

// ============================================================================
// MODULAR MESSAGE HANDLERS
// ============================================================================

/**
 * Handles standard WebRTC room creation (Direct Beam host).
 */
function handleCreateRoom(ws) {
  const newRoomId = generateRoomId();

  // Set timeout to destroy room if no receiver joins within 5 minutes
  const timeoutId = setTimeout(() => {
    const room = rooms.get(newRoomId);
    if (room && !room.peerWs) {
      safeSend(room.hostWs, { type: 'error', message: 'Room expired: No peer joined within 5 minutes' });
      destroyRoom(newRoomId, 'Room expired');
    }
  }, UNJOINED_ROOM_TTL_MS);

  rooms.set(newRoomId, {
    id: newRoomId,
    hostWs: ws,
    peerWs: null,
    createdAt: Date.now(),
    timeoutId: timeoutId
  });

  ws.activeRoomId = newRoomId;
  ws.role = 'host';

  safeSend(ws, {
    type: 'room-created',
    roomId: newRoomId
  });
}

/**
 * Handles a receiver joining a standard Direct Beam WebRTC room.
 */
function handleJoinRoom(ws, roomId) {
  if (!roomId || !rooms.has(roomId)) {
    return safeSend(ws, { type: 'error', message: 'Room not found or link has expired' });
  }

  const room = rooms.get(roomId);

  // If another peer is already actively connected
  if (room.peerWs && room.peerWs.readyState === ws.OPEN && room.peerWs !== ws) {
    return safeSend(ws, { type: 'error', message: 'Room is full (already has 2 peers)' });
  }

  if (room.peerGraceTimer) {
    clearTimeout(room.peerGraceTimer);
    room.peerGraceTimer = null;
  }
  if (room.timeoutId) {
    clearTimeout(room.timeoutId);
    room.timeoutId = null;
  }

  room.peerWs = ws;
  ws.activeRoomId = roomId;
  ws.role = 'peer';

  safeSend(ws, { type: 'room-joined', roomId: roomId });

  if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
    safeSend(room.hostWs, { type: 'peer-joined', roomId: roomId });
    safeSend(room.hostWs, { type: 'peer-resumed' });
  }
}

/**
 * Relays WebRTC signaling data (SDP offer/answer or ICE candidate) between two peers.
 */
function handleSignal(ws, roomId, data) {
  const currentRoomId = roomId || ws.activeRoomId;
  if (!currentRoomId || !rooms.has(currentRoomId)) {
    return safeSend(ws, { type: 'error', message: 'Room not found' });
  }

  const room = rooms.get(currentRoomId);
  const targetWs = (ws === room.hostWs) ? room.peerWs : room.hostWs;

  if (targetWs && targetWs.readyState === targetWs.OPEN) {
    safeSend(targetWs, { type: 'signal', data: data });
  }
}

/**
 * Handles Wormhole room opening with host's ECDH public key.
 */
function handleWormholeOpen(ws, roomId, pubkey) {
  if (!roomId || !pubkey) {
    return safeSend(ws, { type: 'error', message: 'wh-open: missing roomId or pubkey' });
  }

  if (rooms.has(roomId)) {
    const existing = rooms.get(roomId);
    // Allow the original host to reconnect if connection dropped
    const canHostReconnect = !existing.hostWs || existing.hostWs.readyState !== ws.OPEN || existing.hostPubkey === pubkey;
    if (canHostReconnect) {
      if (existing.hostGraceTimer) {
        clearTimeout(existing.hostGraceTimer);
        existing.hostGraceTimer = null;
      }
      existing.hostWs = ws;
      existing.hostPubkey = pubkey;
      ws.activeRoomId = roomId;
      ws.role = 'host';
      safeSend(ws, { type: 'wh-ready', roomId: roomId, reconnected: true });

      if (existing.peerWs && existing.peerWs.readyState === ws.OPEN) {
        safeSend(ws, { type: 'wh-peer-joined', pubkey: existing.peerPubkey });
        safeSend(existing.peerWs, { type: 'peer-resumed' });
      }
      return;
    } else {
      return safeSend(ws, { type: 'error', message: 'Wormhole room already open. Try again.' });
    }
  }

  const timeoutId = setTimeout(() => {
    const r = rooms.get(roomId);
    if (r && !r.peerWs) {
      safeSend(r.hostWs, { type: 'error', message: 'Wormhole expired: no receiver connected within 5 minutes' });
      destroyRoom(roomId, 'Wormhole expired');
    }
  }, UNJOINED_ROOM_TTL_MS);

  rooms.set(roomId, {
    id: roomId,
    hostWs: ws,
    hostPubkey: pubkey,
    peerWs: null,
    peerPubkey: null,
    createdAt: Date.now(),
    timeoutId: timeoutId,
    isWormhole: true
  });

  ws.activeRoomId = roomId;
  ws.role = 'host';
  safeSend(ws, { type: 'wh-ready', roomId: roomId });
}

/**
 * Handles Wormhole receiver joining with their ECDH public key.
 */
function handleWormholeJoin(ws, roomId, pubkey) {
  if (!roomId || !pubkey) {
    return safeSend(ws, { type: 'error', message: 'wh-join: missing roomId or pubkey' });
  }

  const room = rooms.get(roomId);
  if (!room || !room.isWormhole) {
    return safeSend(ws, { type: 'error', message: 'Wormhole not found or expired. Check the passphrase.' });
  }

  // Prevent a 3rd party from hijacking if someone is already connected
  if (room.peerWs && room.peerWs.readyState === ws.OPEN && room.peerPubkey !== pubkey) {
    return safeSend(ws, { type: 'error', message: 'Wormhole already in use by another receiver.' });
  }

  if (room.peerGraceTimer) {
    clearTimeout(room.peerGraceTimer);
    room.peerGraceTimer = null;
  }
  if (room.timeoutId) {
    clearTimeout(room.timeoutId);
    room.timeoutId = null;
  }

  room.peerWs = ws;
  room.peerPubkey = pubkey;
  ws.activeRoomId = roomId;
  ws.role = 'peer';

  // Blindly exchange public keys between both parties
  if (room.hostWs && room.hostWs.readyState === ws.OPEN) {
    safeSend(room.hostWs, { type: 'wh-peer-joined', pubkey: pubkey });
    safeSend(room.hostWs, { type: 'peer-resumed' });
  }
  safeSend(ws, { type: 'wh-joined', pubkey: room.hostPubkey });
}

/**
 * Relays Wormhole WebRTC signaling messages between sender and receiver.
 */
function handleWormholeSignal(ws, roomId, data) {
  const currentRoomId = roomId || ws.activeRoomId;
  if (!currentRoomId || !rooms.has(currentRoomId)) {
    return safeSend(ws, { type: 'error', message: 'Wormhole room not found for signaling' });
  }

  const room = rooms.get(currentRoomId);
  const targetWs = (ws === room.hostWs) ? room.peerWs : room.hostWs;
  if (targetWs && targetWs.readyState === ws.OPEN) {
    safeSend(targetWs, { type: 'wh-signal', data: data });
  }
}

/**
 * Relays an encrypted chunk over WebSocket when direct P2P is blocked by firewalls.
 * The server sees only ciphertext (blind relay).
 */
function handleWormholeChunk(ws, roomId, chunkData) {
  const currentRoomId = roomId || ws.activeRoomId;
  if (!currentRoomId || !rooms.has(currentRoomId)) {
    return;
  }

  const room = rooms.get(currentRoomId);
  const targetWs = (ws === room.hostWs) ? room.peerWs : room.hostWs;
  if (targetWs && targetWs.readyState === ws.OPEN) {
    safeSend(targetWs, { type: 'wh-chunk', data: chunkData });
  }
}

/**
 * Handles explicit mobile reconnect requests when returning from background.
 */
function handleReconnect(ws, roomId, role) {
  const targetId = roomId || ws.activeRoomId;
  if (!targetId || !rooms.has(targetId)) {
    return safeSend(ws, { type: 'error', message: 'Room has expired or closed.' });
  }

  const room = rooms.get(targetId);

  if (role === 'host') {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
    room.hostWs = ws;
    ws.activeRoomId = targetId;
    ws.role = 'host';
    safeSend(ws, { type: 'reconnected', role: 'host' });

    if (room.peerWs && room.peerWs.readyState === ws.OPEN) {
      safeSend(room.peerWs, { type: 'peer-resumed' });
      safeSend(ws, { type: 'peer-joined', roomId: targetId, reconnected: true });
    }
  } else if (role === 'peer') {
    if (room.peerGraceTimer) {
      clearTimeout(room.peerGraceTimer);
      room.peerGraceTimer = null;
    }
    room.peerWs = ws;
    ws.activeRoomId = targetId;
    ws.role = 'peer';
    safeSend(ws, { type: 'reconnected', role: 'peer' });

    if (room.hostWs && room.hostWs.readyState === ws.OPEN) {
      safeSend(room.hostWs, { type: 'peer-resumed' });
      safeSend(room.hostWs, { type: 'peer-joined', roomId: targetId, reconnected: true });
    }
  }
}

// ============================================================================
// WEBSOCKET SERVER INITIALIZATION
// ============================================================================

/**
 * Initializes the WebSocket Signaling Server attached to the main Express HTTP server.
 *
 * @param {object} httpServer - The active Node.js HTTP server.
 * @returns {object} Object containing { wss, rooms }.
 */
function initSignaling(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Periodically send WebSocket ping frames every 30 seconds to keep connections alive
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((clientWs) => {
      if (clientWs.isAlive === false) {
        return clientWs.terminate();
      }
      clientWs.isAlive = false;
      clientWs.ping();
    });
  }, PING_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.activeRoomId = null;
    ws.role = null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawBytes) => {
      let message;
      try {
        message = JSON.parse(rawBytes.toString());
      } catch (err) {
        return safeSend(ws, { type: 'error', message: 'Invalid JSON message' });
      }

      const { type, roomId, data, pubkey, role } = message;

      // Dispatch to single-purpose handler functions
      switch (type) {
        case 'create-room':
          handleCreateRoom(ws);
          break;

        case 'join-room':
          handleJoinRoom(ws, roomId);
          break;

        case 'signal':
          handleSignal(ws, roomId, data);
          break;

        case 'leave-room': {
          const idToLeave = roomId || ws.activeRoomId;
          if (idToLeave && rooms.has(idToLeave)) {
            destroyRoom(idToLeave, 'Peer left the transfer');
          }
          break;
        }

        case 'wh-open':
          handleWormholeOpen(ws, roomId, pubkey);
          break;

        case 'wh-join':
          handleWormholeJoin(ws, roomId, pubkey);
          break;

        case 'wh-signal':
          handleWormholeSignal(ws, roomId, data);
          break;

        case 'wh-chunk':
          handleWormholeChunk(ws, roomId, message.data);
          break;

        case 'reconnect':
          handleReconnect(ws, roomId, role);
          break;

        default:
          safeSend(ws, { type: 'error', message: `Unknown message type: ${type}` });
          break;
      }
    });

    ws.on('close', () => {
      handlePeerDisconnect(ws, 'Peer connection closed');
    });

    ws.on('error', (err) => {
      console.error('WebSocket connection error:', err.message);
      handlePeerDisconnect(ws, 'Peer encountered an error');
    });
  });

  return { wss, rooms };
}

module.exports = {
  initSignaling,
  rooms,
  generateRoomId,
  destroyRoom
};
