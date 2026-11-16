// TCP with node:net: an echo server, a client, and a tiny text protocol on top
// Run: node lessons/12-http-and-networking/examples/02-tcp-echo.js
//
// TCP gives you a two-way stream of bytes. It does NOT give you messages.
// HTTP, Redis, SMTP and friends are rules for how to cut that stream into messages.

const net = require('node:net');
const readline = require('node:readline');
const { once } = require('node:events');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

// Part 1: the classic echo server. A socket is a Duplex stream (readable AND writable),
// so "send back whatever arrives" is one pipe: socket.pipe(socket).
async function echoDemo() {
  console.log('Part 1: echo server');
  let clients = 0;
  const server = net.createServer((socket) => {
    clients++;
    socket.pipe(socket);
  });
  const port = await listen(server);

  const client = net.connect({ host: '127.0.0.1', port });
  client.setEncoding('utf8');
  client.write('hello ');
  client.write('world');
  client.end(); // "I have nothing more to send" (half-close). The server then ends too.

  let received = '';
  for await (const chunk of client) received += chunk; // a socket is async iterable
  console.log('  client sent "hello " and "world", got back:', JSON.stringify(received));
  console.log('  server saw', clients, 'client');
  server.close();
  await once(server, 'close');
}

// Part 2: the same stream, but with a rule: "one command per line".
// readline cuts the byte stream into lines for us, however the bytes were chunked.
async function protocolDemo() {
  console.log('Part 2: a tiny line protocol (PING, ADD a b, anything else is an error)');
  const server = net.createServer((socket) => {
    const lines = readline.createInterface({ input: socket });
    lines.on('line', (line) => {
      const [command, ...args] = line.trim().split(' ');
      if (command === 'PING') socket.write('PONG\n');
      else if (command === 'ADD') socket.write(`${Number(args[0]) + Number(args[1])}\n`);
      else socket.write(`ERR unknown command "${command}"\n`);
    });
    socket.on('error', () => {}); // a client that vanishes must not crash the server
  });
  const port = await listen(server);

  const client = net.connect({ host: '127.0.0.1', port });
  // Three commands in ONE write. The server still sees three separate lines.
  client.write('PING\nADD 2 3\nHELLO\n');
  client.end();

  const replies = [];
  for await (const line of readline.createInterface({ input: client })) replies.push(line);
  console.log('  replies:', replies);
  server.close();
  await once(server, 'close');
}

// Part 3: what happens when nobody is listening.
async function refusedDemo() {
  console.log('Part 3: connecting to a closed port');
  const temp = net.createServer();
  const port = await listen(temp);
  temp.close();
  await once(temp, 'close'); // now the port is free and nobody listens on it

  const client = net.connect({ host: '127.0.0.1', port });
  const [err] = await once(client, 'error');
  console.log('  error code:', err.code);
}

async function main() {
  await echoDemo();
  await protocolDemo();
  await refusedDemo();
}

main();
