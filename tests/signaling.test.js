const http = require('http');
const WebSocket = require('ws');
const { initSignaling, rooms, destroyRoom } = require('../src/signaling');

describe('LinkVault WebSocket Signaling Engine Test Suite', () => {
  let server;
  let port;
  let wssInstance;

  beforeAll((done) => {
    server = http.createServer();
    const { wss } = initSignaling(server);
    wssInstance = wss;
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    wssInstance.close(() => {
      server.close(done);
    });
  });

  afterEach(() => {
    // Clear all test rooms
    for (const roomId of rooms.keys()) {
      destroyRoom(roomId, 'Test cleanup');
    }
  });

  function createClient() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws, filterFn) {
    return new Promise((resolve) => {
      const handler = (rawData) => {
        const msg = JSON.parse(rawData.toString());
        if (!filterFn || filterFn(msg)) {
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
  }

  test('Host creates a room with 16-hex-character ID', async () => {
    const host = await createClient();

    const responsePromise = waitForMessage(host, (m) => m.type === 'room-created');
    host.send(JSON.stringify({ type: 'create-room' }));

    const res = await responsePromise;
    expect(res.type).toBe('room-created');
    expect(res.roomId).toMatch(/^[a-f0-9]{16}$/); // 16 hex characters
    expect(rooms.has(res.roomId)).toBe(true);

    host.close();
  });

  test('Peer joins room and notifies host', async () => {
    const host = await createClient();
    const peer = await createClient();

    // 1. Host creates room
    const hostCreatePromise = waitForMessage(host, (m) => m.type === 'room-created');
    host.send(JSON.stringify({ type: 'create-room' }));
    const { roomId } = await hostCreatePromise;

    // 2. Peer joins room
    const hostNotifiedPromise = waitForMessage(host, (m) => m.type === 'peer-joined');
    const peerAckPromise = waitForMessage(peer, (m) => m.type === 'room-joined');

    peer.send(JSON.stringify({ type: 'join-room', roomId }));

    const peerAck = await peerAckPromise;
    const hostNotified = await hostNotifiedPromise;

    expect(peerAck.type).toBe('room-joined');
    expect(peerAck.roomId).toBe(roomId);
    expect(hostNotified.type).toBe('peer-joined');
    expect(hostNotified.roomId).toBe(roomId);

    host.close();
    peer.close();
  });

  test('Strict 2-Peer Lock: Rejects 3rd connection attempt with Room Full error', async () => {
    const host = await createClient();
    const peer1 = await createClient();
    const peer2 = await createClient();

    // 1. Host creates room
    const hostCreatePromise = waitForMessage(host, (m) => m.type === 'room-created');
    host.send(JSON.stringify({ type: 'create-room' }));
    const { roomId } = await hostCreatePromise;

    // 2. Peer 1 joins
    const peer1AckPromise = waitForMessage(peer1, (m) => m.type === 'room-joined');
    peer1.send(JSON.stringify({ type: 'join-room', roomId }));
    await peer1AckPromise;

    // 3. Peer 2 attempts to join
    const peer2ErrorPromise = waitForMessage(peer2, (m) => m.type === 'error');
    peer2.send(JSON.stringify({ type: 'join-room', roomId }));
    const err = await peer2ErrorPromise;

    expect(err.type).toBe('error');
    expect(err.message).toMatch(/room is full/i);

    host.close();
    peer1.close();
    peer2.close();
  });

  test('Signals (SDP / ICE) are faithfully relayed between peers', async () => {
    const host = await createClient();
    const peer = await createClient();

    const hostCreatePromise = waitForMessage(host, (m) => m.type === 'room-created');
    host.send(JSON.stringify({ type: 'create-room' }));
    const { roomId } = await hostCreatePromise;

    const peerAckPromise = waitForMessage(peer, (m) => m.type === 'room-joined');
    peer.send(JSON.stringify({ type: 'join-room', roomId }));
    await peerAckPromise;

    // Host sends mock SDP offer
    const peerSignalPromise = waitForMessage(peer, (m) => m.type === 'signal');
    host.send(JSON.stringify({
      type: 'signal',
      roomId,
      data: { sdp: 'v=0\r\no=mockHost', type: 'offer' }
    }));

    const receivedByPeer = await peerSignalPromise;
    expect(receivedByPeer.data.type).toBe('offer');
    expect(receivedByPeer.data.sdp).toBe('v=0\r\no=mockHost');

    // Peer sends mock SDP answer back to host
    const hostSignalPromise = waitForMessage(host, (m) => m.type === 'signal');
    peer.send(JSON.stringify({
      type: 'signal',
      roomId,
      data: { sdp: 'v=0\r\no=mockPeer', type: 'answer' }
    }));

    const receivedByHost = await hostSignalPromise;
    expect(receivedByHost.data.type).toBe('answer');
    expect(receivedByHost.data.sdp).toBe('v=0\r\no=mockPeer');

    host.close();
    peer.close();
  });

  test('Surviving peer is notified and room is purged when peer disconnects', async () => {
    const host = await createClient();
    const peer = await createClient();

    const hostCreatePromise = waitForMessage(host, (m) => m.type === 'room-created');
    host.send(JSON.stringify({ type: 'create-room' }));
    const { roomId } = await hostCreatePromise;

    const peerAckPromise = waitForMessage(peer, (m) => m.type === 'room-joined');
    peer.send(JSON.stringify({ type: 'join-room', roomId }));
    await peerAckPromise;

    // Peer closes connection
    const hostDisconnectPromise = waitForMessage(host, (m) => m.type === 'peer-disconnected');
    peer.close();

    const notification = await hostDisconnectPromise;
    expect(notification.type).toBe('peer-disconnected');
    expect(rooms.has(roomId)).toBe(false);

    host.close();
  });

  describe('Wormhole PAKE / Blind Relay Signaling', () => {
    const mockRoomId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const hostPubkey = '04abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const peerPubkey = '04fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';

    test('Host opens a wormhole room with wh-open', async () => {
      const host = await createClient();

      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({
        type: 'wh-open',
        roomId: mockRoomId,
        pubkey: hostPubkey
      }));

      const res = await readyPromise;
      expect(res.type).toBe('wh-ready');
      expect(res.roomId).toBe(mockRoomId);
      expect(rooms.has(mockRoomId)).toBe(true);

      host.close();
    });

    test('Receiver joins via wh-join and peers cross-exchange ECDH public keys', async () => {
      const host = await createClient();
      const peer = await createClient();

      // 1. Host opens
      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({
        type: 'wh-open',
        roomId: mockRoomId,
        pubkey: hostPubkey
      }));
      await readyPromise;

      // 2. Peer joins
      const hostNotifiedPromise = waitForMessage(host, (m) => m.type === 'wh-peer-joined');
      const peerJoinedPromise = waitForMessage(peer, (m) => m.type === 'wh-joined');

      peer.send(JSON.stringify({
        type: 'wh-join',
        roomId: mockRoomId,
        pubkey: peerPubkey
      }));

      const peerAck = await peerJoinedPromise;
      const hostAck = await hostNotifiedPromise;

      // Peer receives host's public key
      expect(peerAck.type).toBe('wh-joined');
      expect(peerAck.pubkey).toBe(hostPubkey);

      // Host receives peer's public key
      expect(hostAck.type).toBe('wh-peer-joined');
      expect(hostAck.pubkey).toBe(peerPubkey);

      host.close();
      peer.close();
    });

    test('Relays wh-signal payloads bidirectionally between wormhole peers', async () => {
      const host = await createClient();
      const peer = await createClient();

      // Setup session
      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({ type: 'wh-open', roomId: mockRoomId, pubkey: hostPubkey }));
      await readyPromise;

      const peerJoinedPromise = waitForMessage(peer, (m) => m.type === 'wh-joined');
      peer.send(JSON.stringify({ type: 'wh-join', roomId: mockRoomId, pubkey: peerPubkey }));
      await peerJoinedPromise;

      // Host -> Peer
      const peerSignalPromise = waitForMessage(peer, (m) => m.type === 'wh-signal');
      host.send(JSON.stringify({
        type: 'wh-signal',
        roomId: mockRoomId,
        data: { type: 'offer', sdp: 'v=0\r\no=whHost' }
      }));
      const sigToPeer = await peerSignalPromise;
      expect(sigToPeer.data.type).toBe('offer');
      expect(sigToPeer.data.sdp).toBe('v=0\r\no=whHost');

      // Peer -> Host
      const hostSignalPromise = waitForMessage(host, (m) => m.type === 'wh-signal');
      peer.send(JSON.stringify({
        type: 'wh-signal',
        roomId: mockRoomId,
        data: { type: 'answer', sdp: 'v=0\r\no=whPeer' }
      }));
      const sigToHost = await hostSignalPromise;
      expect(sigToHost.data.type).toBe('answer');
      expect(sigToHost.data.sdp).toBe('v=0\r\no=whPeer');

      host.close();
      peer.close();
    });

    test('Rejects joining nonexistent or expired wormhole room', async () => {
      const peer = await createClient();

      const errPromise = waitForMessage(peer, (m) => m.type === 'error');
      peer.send(JSON.stringify({
        type: 'wh-join',
        roomId: 'nonexistent-room-id',
        pubkey: peerPubkey
      }));

      const err = await errPromise;
      expect(err.type).toBe('error');
      expect(err.message).toMatch(/not found or expired/i);

      peer.close();
    });

    test('Rejects 3rd peer trying to join an already claimed wormhole', async () => {
      const host = await createClient();
      const peer1 = await createClient();
      const peer2 = await createClient();

      // Host opens
      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({ type: 'wh-open', roomId: mockRoomId, pubkey: hostPubkey }));
      await readyPromise;

      // Peer 1 joins
      const peer1Joined = waitForMessage(peer1, (m) => m.type === 'wh-joined');
      peer1.send(JSON.stringify({ type: 'wh-join', roomId: mockRoomId, pubkey: peerPubkey }));
      await peer1Joined;

      // Peer 2 attempts to join same room
      const peer2Err = waitForMessage(peer2, (m) => m.type === 'error');
      peer2.send(JSON.stringify({ type: 'wh-join', roomId: mockRoomId, pubkey: 'another-pubkey' }));
      const err = await peer2Err;

      expect(err.type).toBe('error');
      expect(err.message).toMatch(/already in use/i);

      host.close();
      peer1.close();
      peer2.close();
    });

    test('Cleans up wormhole room and alerts surviving peer on disconnect', async () => {
      const host = await createClient();
      const peer = await createClient();

      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({ type: 'wh-open', roomId: mockRoomId, pubkey: hostPubkey }));
      await readyPromise;

      const peerJoined = waitForMessage(peer, (m) => m.type === 'wh-joined');
      peer.send(JSON.stringify({ type: 'wh-join', roomId: mockRoomId, pubkey: peerPubkey }));
      await peerJoined;

      const hostNotice = waitForMessage(host, (m) => m.type === 'peer-disconnected');
      peer.close();

      const notice = await hostNotice;
      expect(notice.type).toBe('peer-disconnected');
      expect(rooms.has(mockRoomId)).toBe(false);

      host.close();
    });

    test('wh-chunk blind relays encrypted blobs between peers without inspection', async () => {
      const host = await createClient();
      const peer = await createClient();

      const readyPromise = waitForMessage(host, (m) => m.type === 'wh-ready');
      host.send(JSON.stringify({ type: 'wh-open', roomId: mockRoomId, pubkey: hostPubkey }));
      await readyPromise;

      const peerJoined = waitForMessage(peer, (m) => m.type === 'wh-joined');
      peer.send(JSON.stringify({ type: 'wh-join', roomId: mockRoomId, pubkey: peerPubkey }));
      await peerJoined;

      // Host sends encrypted chunk to peer
      const peerChunkPromise = waitForMessage(peer, (m) => m.type === 'wh-chunk');
      const mockCipherBlob = 'deadbeefcafebabe01020304';
      host.send(JSON.stringify({ type: 'wh-chunk', roomId: mockRoomId, data: mockCipherBlob }));

      const received = await peerChunkPromise;
      expect(received.type).toBe('wh-chunk');
      expect(received.data).toBe(mockCipherBlob);

      // Peer sends encrypted ack to host
      const hostChunkPromise = waitForMessage(host, (m) => m.type === 'wh-chunk');
      peer.send(JSON.stringify({ type: 'wh-chunk', roomId: mockRoomId, data: 'ack12345' }));

      const hostReceived = await hostChunkPromise;
      expect(hostReceived.type).toBe('wh-chunk');
      expect(hostReceived.data).toBe('ack12345');

      host.close();
      peer.close();
    });

    test('reconnect reattaches socket and notifies peer', async () => {
      const host = await createClient();
      const peer = await createClient();

      // Host creates standard room
      const hostCreate = waitForMessage(host, (m) => m.type === 'room-created');
      host.send(JSON.stringify({ type: 'create-room' }));
      const { roomId } = await hostCreate;

      // Peer joins
      const peerJoined = waitForMessage(peer, (m) => m.type === 'room-joined');
      peer.send(JSON.stringify({ type: 'join-room', roomId }));
      await peerJoined;

      // New socket for peer reconnecting
      const peerNewSocket = await createClient();
      const peerAck = waitForMessage(peerNewSocket, (m) => m.type === 'reconnected');
      const hostResumed = waitForMessage(host, (m) => m.type === 'peer-resumed');

      peerNewSocket.send(JSON.stringify({ type: 'reconnect', roomId, role: 'peer' }));

      const ack = await peerAck;
      const resumed = await hostResumed;
      expect(ack.type).toBe('reconnected');
      expect(ack.role).toBe('peer');
      expect(resumed.type).toBe('peer-resumed');

      host.close();
      peer.close();
      peerNewSocket.close();
    });
  });
});
