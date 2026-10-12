/**
 * LinkVault - WebSocket Signaling Server (WebRTC Direct Beam & Wormhole)
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const rooms = new Map();
const UNJOINED_ROOM_TTL_MS = 5 * 60 * 1000;
const PING_INTERVAL_MS = 30 * 1000;
const DISCONNECT_GRACE_MS = process.env.NODE_ENV === 'test' ? 0 : 60 * 1000;

function generateRoomId() {
  return crypto.randomBytes(8).toString('hex');
}

function safeSend(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {}
  }
}

function getOtherWs(room, ws) {
  return ws === room.hostWs ? room.peerWs : room.hostWs;
}

function destroyRoom(roomId, reason = 'Room closed') {
  const room = rooms.get(roomId);
  if (!room) return;

  ['timeoutId', 'hostGraceTimer', 'peerGraceTimer'].forEach((timer) => {
    if (room[timer]) clearTimeout(room[timer]);
  });

  const notice = { type: 'peer-disconnected', message: reason };
  safeSend(room.hostWs, notice);
  safeSend(room.peerWs, notice);
  rooms.delete(roomId);
}

function handlePeerDisconnect(ws, reason) {
  const roomId = ws.activeRoomId;
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);

  if (DISCONNECT_GRACE_MS === 0) {
    destroyRoom(roomId, reason);
    return;
  }

  const role = ws.role;
  if (!role) return;
  const otherWs = getOtherWs(room, ws);
  const timerKey = `${role}GraceTimer`;

  room[`${role}Ws`] = null;
  if (room[timerKey]) clearTimeout(room[timerKey]);

  safeSend(otherWs, {
    type: 'peer-disconnected',
    message: `${role === 'host' ? 'Sender' : 'Recipient'} moved away or backgrounded app. Waiting up to 60s for reconnect...`,
    transient: true
  });

  room[timerKey] = setTimeout(() => {
    if (rooms.has(roomId) && !room[`${role}Ws`]) {
      destroyRoom(roomId, `${role === 'host' ? 'Sender' : 'Recipient'} did not reconnect within grace period`);
    }
  }, DISCONNECT_GRACE_MS);
}

function relay(ws, roomId, type, data) {
  const id = roomId || ws.activeRoomId;
  if (!id || !rooms.has(id)) {
    if (type !== 'wh-chunk') safeSend(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  const target = getOtherWs(rooms.get(id), ws);
  if (target && target.readyState === target.OPEN) {
    safeSend(target, { type, data });
  }
}

function handleCreateRoom(ws) {
  const newRoomId = generateRoomId();
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
    timeoutId
  });

  ws.activeRoomId = newRoomId;
  ws.role = 'host';
  safeSend(ws, { type: 'room-created', roomId: newRoomId });
}

function handleJoinRoom(ws, roomId) {
  if (!roomId || !rooms.has(roomId)) {
    return safeSend(ws, { type: 'error', message: 'Room not found or link has expired' });
  }
  const room = rooms.get(roomId);
  if (room.peerWs && room.peerWs.readyState === ws.OPEN && room.peerWs !== ws) {
    return safeSend(ws, { type: 'error', message: 'Room is full (already has 2 peers)' });
  }

  if (room.peerGraceTimer) clearTimeout(room.peerGraceTimer);
  if (room.timeoutId) clearTimeout(room.timeoutId);

  room.peerWs = ws;
  ws.activeRoomId = roomId;
  ws.role = 'peer';

  safeSend(ws, { type: 'room-joined', roomId });
  if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
    safeSend(room.hostWs, { type: 'peer-joined', roomId });
    safeSend(room.hostWs, { type: 'peer-resumed' });
  }
}

function handleWormholeOpen(ws, roomId, pubkey) {
  if (!roomId || !pubkey) {
    return safeSend(ws, { type: 'error', message: 'wh-open: missing roomId or pubkey' });
  }

  if (rooms.has(roomId)) {
    const existing = rooms.get(roomId);
    const canReconnect = !existing.hostWs || existing.hostWs.readyState !== ws.OPEN || existing.hostPubkey === pubkey;
    if (canReconnect) {
      if (existing.hostGraceTimer) clearTimeout(existing.hostGraceTimer);
      existing.hostWs = ws;
      existing.hostPubkey = pubkey;
      ws.activeRoomId = roomId;
      ws.role = 'host';
      safeSend(ws, { type: 'wh-ready', roomId, reconnected: true });
      if (existing.peerWs && existing.peerWs.readyState === ws.OPEN) {
        safeSend(ws, { type: 'wh-peer-joined', pubkey: existing.peerPubkey });
        safeSend(existing.peerWs, { type: 'peer-resumed' });
      }
      return;
    }
    return safeSend(ws, { type: 'error', message: 'Wormhole room already open. Try again.' });
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
    timeoutId,
    isWormhole: true
  });

  ws.activeRoomId = roomId;
  ws.role = 'host';
  safeSend(ws, { type: 'wh-ready', roomId });
}

function handleWormholeJoin(ws, roomId, pubkey) {
  if (!roomId || !pubkey) {
    return safeSend(ws, { type: 'error', message: 'wh-join: missing roomId or pubkey' });
  }
  const room = rooms.get(roomId);
  if (!room || !room.isWormhole) {
    return safeSend(ws, { type: 'error', message: 'Wormhole not found or expired. Check the passphrase.' });
  }
  if (room.peerWs && room.peerWs.readyState === ws.OPEN && room.peerPubkey !== pubkey) {
    return safeSend(ws, { type: 'error', message: 'Wormhole already in use by another receiver.' });
  }

  if (room.peerGraceTimer) clearTimeout(room.peerGraceTimer);
  if (room.timeoutId) clearTimeout(room.timeoutId);

  room.peerWs = ws;
  room.peerPubkey = pubkey;
  ws.activeRoomId = roomId;
  ws.role = 'peer';

  if (room.hostWs && room.hostWs.readyState === ws.OPEN) {
    safeSend(room.hostWs, { type: 'wh-peer-joined', pubkey });
    safeSend(room.hostWs, { type: 'peer-resumed' });
  }
  safeSend(ws, { type: 'wh-joined', pubkey: room.hostPubkey });
}

function handleReconnect(ws, roomId, role) {
  const targetId = roomId || ws.activeRoomId;
  if (!targetId || !rooms.has(targetId)) {
    return safeSend(ws, { type: 'error', message: 'Room has expired or closed.' });
  }
  const room = rooms.get(targetId);
  const timerKey = `${role}GraceTimer`;
  if (room[timerKey]) clearTimeout(room[timerKey]);

  room[`${role}Ws`] = ws;
  ws.activeRoomId = targetId;
  ws.role = role;
  safeSend(ws, { type: 'reconnected', role });

  const otherWs = getOtherWs(room, ws);
  if (otherWs && otherWs.readyState === ws.OPEN) {
    safeSend(otherWs, { type: 'peer-resumed' });
    safeSend(ws, { type: 'peer-joined', roomId: targetId, reconnected: true });
  }
}

function initSignaling(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((client) => {
      if (!client.isAlive) return client.terminate();
      client.isAlive = false;
      client.ping();
    });
  }, PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.activeRoomId = null;
    ws.role = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        return safeSend(ws, { type: 'error', message: 'Invalid JSON message' });
      }

      const { type, roomId, data, pubkey, role } = msg;

      switch (type) {
        case 'create-room': return handleCreateRoom(ws);
        case 'join-room': return handleJoinRoom(ws, roomId);
        case 'signal': return relay(ws, roomId, 'signal', data);
        case 'leave-room': {
          const id = roomId || ws.activeRoomId;
          if (id && rooms.has(id)) destroyRoom(id, 'Peer left the transfer');
          return;
        }
        case 'wh-open': return handleWormholeOpen(ws, roomId, pubkey);
        case 'wh-join': return handleWormholeJoin(ws, roomId, pubkey);
        case 'wh-signal': return relay(ws, roomId, 'wh-signal', data);
        case 'wh-chunk': return relay(ws, roomId, 'wh-chunk', msg.data);
        case 'reconnect': return handleReconnect(ws, roomId, role);
        default: return safeSend(ws, { type: 'error', message: `Unknown message type: ${type}` });
      }
    });

    ws.on('close', () => handlePeerDisconnect(ws, 'Peer connection closed'));
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
