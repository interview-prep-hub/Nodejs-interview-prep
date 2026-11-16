// Helper (not run by itself): a small but careful WebSocket server built with core modules only.
// Used by examples 04 and 06-12. Read it top to bottom, it is about 260 lines.
// Example 05 is the same idea squeezed into one short file, read that one first.
//
//   const { createWebSocketServer } = require('./_mini-ws');
//   const wss = createWebSocketServer(httpServer);
//   wss.on('connection', (ws, req) => { ws.on('message', (data) => ws.send(data)); });
//
// What it supports: the HTTP Upgrade handshake, text and binary messages, fragmented
// messages, ping/pong, the close handshake, masking checks and a maximum message size.
// What it skips on purpose: extensions (permessage-deflate), sub-protocols, rate limits.

const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // fixed value from RFC 6455
const OPCODES = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const STATE = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

// Sec-WebSocket-Accept = base64( sha1( Sec-WebSocket-Key + GUID ) )
function acceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + GUID).digest('base64');
}

class ProtocolError extends Error {
  constructor(message, closeCode) {
    super(message);
    this.closeCode = closeCode;
  }
}

// Build one frame. Servers send unmasked frames; pass { mask: true } to build a client frame.
function encodeFrame(opcode, payload = Buffer.alloc(0), { fin = true, mask = false, maskKey } = {}) {
  const length = payload.length;
  const maskBit = mask ? 0x80 : 0;
  let header;
  if (length < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, maskBit | length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = maskBit | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  if (!mask) return Buffer.concat([header, payload]);
  const key = maskKey || crypto.randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= key[i % 4];
  return Buffer.concat([header, key, masked]);
}

// Read ONE frame from the start of the buffer.
// Returns null when more bytes are needed, or { fin, opcode, masked, payload, bytesUsed }.
function decodeFrame(buffer, maxPayload = Infinity) {
  if (buffer.length < 2) return null;
  const fin = (buffer[0] & 0x80) !== 0;
  const rsv = buffer[0] & 0x70;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(maxPayload)) throw new ProtocolError('message too big', 1009);
    length = Number(big);
    offset = 10;
  }
  if (rsv !== 0) throw new ProtocolError('reserved bits set', 1002);
  if (opcode >= 0x8 && (length > 125 || !fin)) throw new ProtocolError('bad control frame', 1002);
  if (length > maxPayload) throw new ProtocolError('message too big', 1009);
  let key = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    key = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4];
  return { fin, opcode, masked, payload, bytesUsed: offset + length };
}

function closePayload(code, reason = '') {
  const text = Buffer.from(reason);
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return payload;
}

class MiniSocket extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = STATE.OPEN;
    this.pending = Buffer.alloc(0); // bytes received but not yet a whole frame
    this.fragments = []; // pieces of a message that was split into several frames
    this.fragmentOpcode = 0;
    this.fragmentBytes = 0;
    this.closeCode = 1006; // 1006 = "closed without a close frame"
    this.closeReason = '';
    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('end', () => socket.end()); // the peer is done: finish our side too
    socket.on('error', () => {}); // a 'close' event always follows an error
    socket.on('close', () => {
      this.readyState = STATE.CLOSED;
      clearTimeout(this.closeTimer);
      this.emit('close', this.closeCode, this.closeReason);
    });
  }

  // Bytes waiting in Node's write buffer (see example 10, backpressure).
  get bufferedAmount() {
    return this.socket.writableLength;
  }

  // Returns false when Node's write buffer is full: slow down (backpressure).
  send(data) {
    if (this.readyState !== STATE.OPEN) return false;
    const frame = typeof data === 'string'
      ? encodeFrame(OPCODES.TEXT, Buffer.from(data))
      : encodeFrame(OPCODES.BINARY, Buffer.from(data));
    return this.socket.write(frame);
  }

  ping(data = '') {
    if (this.readyState === STATE.OPEN) this.socket.write(encodeFrame(OPCODES.PING, Buffer.from(data)));
  }

  close(code = 1000, reason = '') {
    if (this.readyState !== STATE.OPEN) return;
    this.readyState = STATE.CLOSING;
    this.closeCode = code;
    this.closeReason = reason;
    this.socket.end(encodeFrame(OPCODES.CLOSE, closePayload(code, reason)));
    // If the peer never finishes the closing handshake, cut the connection after 1 second.
    this.closeTimer = setTimeout(() => this.socket.destroy(), 1000);
    this.closeTimer.unref();
  }

  // Hard stop, no closing handshake. Use it for connections that stopped answering.
  terminate() {
    this.socket.destroy();
  }

  feed(chunk) {
    if (this.readyState !== STATE.OPEN) return; // we already started closing: ignore the rest
    this.pending = Buffer.concat([this.pending, chunk]);
    try {
      let frame;
      while ((frame = decodeFrame(this.pending, this.maxPayload))) {
        this.pending = this.pending.subarray(frame.bytesUsed);
        if (!frame.masked) throw new ProtocolError('client frames must be masked', 1002);
        this.handleFrame(frame);
      }
    } catch (err) {
      if (!(err instanceof ProtocolError)) throw err;
      this.pending = Buffer.alloc(0);
      this.close(err.closeCode, err.message);
    }
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OPCODES.PING:
        this.socket.write(encodeFrame(OPCODES.PONG, payload)); // answer with the same bytes
        return this.emit('ping', payload);
      case OPCODES.PONG:
        return this.emit('pong', payload);
      case OPCODES.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; // 1005 = no code given
        const reason = payload.length > 2 ? payload.subarray(2).toString() : '';
        if (this.readyState === STATE.OPEN) {
          this.closeCode = code;
          this.closeReason = reason;
          this.readyState = STATE.CLOSING;
          this.socket.end(encodeFrame(OPCODES.CLOSE, closePayload(code === 1005 ? 1000 : code)));
        }
        return undefined;
      }
      case OPCODES.TEXT:
      case OPCODES.BINARY:
        if (this.fragments.length) throw new ProtocolError('new message inside a fragmented one', 1002);
        this.fragmentOpcode = opcode;
        this.fragments.push(payload);
        this.fragmentBytes = payload.length;
        break;
      case OPCODES.CONTINUATION:
        if (!this.fragments.length) throw new ProtocolError('unexpected continuation frame', 1002);
        this.fragmentBytes += payload.length;
        // The limit is for the whole message, not for one frame, so check while collecting.
        if (this.fragmentBytes > this.maxPayload) throw new ProtocolError('message too big', 1009);
        this.fragments.push(payload);
        break;
      default:
        throw new ProtocolError(`unknown opcode ${opcode}`, 1002);
    }
    if (!fin) return undefined;
    const data = Buffer.concat(this.fragments);
    this.fragments = [];
    if (data.length > this.maxPayload) throw new ProtocolError('message too big', 1009);
    if (this.fragmentOpcode === OPCODES.BINARY) return this.emit('message', data, true);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw new ProtocolError('invalid UTF-8 in a text message', 1007);
    }
    // Emit outside the try block: an error thrown by the application's own handler must not
    // be mistaken for bad UTF-8.
    return this.emit('message', text, false);
  }
}

function rejectUpgrade(socket, status) {
  const text = http.STATUS_CODES[status] || 'Error';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// Attach WebSocket support to an http.Server. Options:
//   maxPayload    biggest message accepted, in bytes (default 1 MiB)
//   verifyClient  (req) => true | { status: 403 }   decide before accepting the upgrade
function createWebSocketServer(httpServer, { maxPayload = 1024 * 1024, verifyClient } = {}) {
  const wss = new EventEmitter();
  wss.clients = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    const wantsWebSocket = String(req.headers.upgrade).toLowerCase() === 'websocket';
    if (req.method !== 'GET' || !wantsWebSocket || !key || req.headers['sec-websocket-version'] !== '13') {
      return rejectUpgrade(socket, 400);
    }
    const verdict = verifyClient ? verifyClient(req) : true;
    if (verdict !== true) return rejectUpgrade(socket, verdict.status || 403);

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true); // send small frames right away
    const ws = new MiniSocket(socket, maxPayload);
    wss.clients.add(ws);
    ws.once('close', () => wss.clients.delete(ws));
    wss.emit('connection', ws, req);
    if (head.length) ws.feed(head); // bytes that arrived together with the handshake
    return undefined;
  });
  return wss;
}

module.exports = { createWebSocketServer, acceptKey, encodeFrame, decodeFrame, closePayload, OPCODES, STATE, GUID };
