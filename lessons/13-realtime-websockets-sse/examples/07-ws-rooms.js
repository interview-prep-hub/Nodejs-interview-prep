// Rooms (channels): send a message to some clients, not to all of them
// Run: node lessons/13-realtime-websockets-sse/examples/07-ws-rooms.js
//
// A room is just a Map from a room name to a Set of connections. Joining adds to the
// Set, leaving removes from it, and closing a connection removes it from every room.

const http = require('node:http');
const { createWebSocketServer } = require('./_mini-ws');
const { connect, sleep } = require('./_test-client');

const server = http.createServer();
const wss = createWebSocketServer(server);

const rooms = new Map(); // room name -> Set of connections

function join(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.rooms.add(room);
}

function leave(ws, room) {
  const members = rooms.get(room);
  if (!members) return;
  members.delete(ws);
  ws.rooms.delete(room);
  if (members.size === 0) rooms.delete(room); // do not keep empty rooms forever
}

function broadcast(room, message, except) {
  const text = JSON.stringify(message);
  for (const member of rooms.get(room) ?? []) {
    if (member !== except) member.send(text);
  }
}

const names = (room) => [...rooms.get(room)].map((ws) => ws.name);
const show = () => [...rooms.keys()].map((room) => `${room}: [${names(room).join(', ')}]`).join('  ');

wss.on('connection', (ws, req) => {
  ws.name = new URL(req.url, 'http://localhost').searchParams.get('name');
  ws.rooms = new Set();
  const reply = (message) => ws.send(JSON.stringify(message));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw); // never trust the input: it may not even be JSON
    } catch {
      return reply({ type: 'error', message: 'send JSON please' });
    }
    if (msg.type === 'join') {
      join(ws, msg.room);
      reply({ type: 'joined', room: msg.room, members: names(msg.room) });
    } else if (msg.type === 'leave') {
      leave(ws, msg.room);
      reply({ type: 'left', room: msg.room });
    } else if (msg.type === 'say') {
      if (!ws.rooms.has(msg.room)) return reply({ type: 'error', message: `join ${msg.room} first` });
      broadcast(msg.room, { type: 'message', room: msg.room, from: ws.name, text: msg.text }, ws);
    }
    return undefined;
  });

  ws.on('close', () => {
    for (const room of [...ws.rooms]) leave(ws, room); // cleanup, or rooms leak dead sockets
  });
});

server.listen(0, '127.0.0.1', async () => {
  const url = (name) => `ws://127.0.0.1:${server.address().port}/?name=${name}`;
  const alice = await connect(url('alice'), { json: true });
  const bob = await connect(url('bob'), { json: true });
  const carol = await connect(url('carol'), { json: true });

  for (const [client, room] of [[alice, 'js'], [bob, 'js'], [carol, 'go']]) {
    client.send({ type: 'join', room });
    const joined = await client.waitFor((m) => m.type === 'joined');
    console.log(`joined ${joined.room}, members now: ${joined.members.join(', ')}`);
  }
  console.log('server rooms ->', show());

  alice.send({ type: 'say', room: 'js', text: 'hi js folks' });
  console.log('bob received:', await bob.waitFor((m) => m.type === 'message'));
  await sleep(30);
  console.log('carol received anything:', carol.pending() > 0);
  console.log('alice received her own message:', alice.pending() > 0);

  carol.send({ type: 'say', room: 'js', text: 'let me in' });
  console.log('carol got:', await carol.waitFor((m) => m.type === 'error'));

  bob.send({ type: 'leave', room: 'js' });
  await bob.waitFor((m) => m.type === 'left');
  alice.send({ type: 'say', room: 'js', text: 'anyone there?' });
  await sleep(30);
  console.log('bob received after leaving:', bob.pending() > 0);
  console.log('server rooms ->', show());

  await Promise.all([alice.close(), bob.close(), carol.close()]);
  while (wss.clients.size > 0) await sleep(5);
  console.log('after everyone closed, rooms left:', rooms.size);
  server.close();
});
