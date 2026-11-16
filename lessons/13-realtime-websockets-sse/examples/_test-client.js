// Helper (not run by itself): a small wrapper around the global WebSocket client,
// so the examples can say "send this, wait for that" in one line.
//
//   const client = await connect(url, { json: true });
//   client.send({ type: 'hello' });
//   const reply = await client.waitFor((m) => m.type === 'welcome');
//   client.close();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(url, { json = false, wsOptions } = {}) {
  return new Promise((resolve, reject) => {
    const ws = wsOptions ? new WebSocket(url, wsOptions) : new WebSocket(url);
    const inbox = []; // messages that arrived and nobody asked for yet
    const waiting = []; // { test, resolve } entries for waitFor()
    let opened = false;
    let onClosed;
    const closed = new Promise((res) => { onClosed = res; });

    const client = {
      ws,
      closed, // resolves with { code, reason, wasClean }
      send(data) {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      },
      // Resolve with the first message accepted by test(message); old messages count too.
      waitFor(test = () => true) {
        const index = inbox.findIndex(test);
        if (index !== -1) return Promise.resolve(inbox.splice(index, 1)[0]);
        return new Promise((res) => waiting.push({ test, resolve: res }));
      },
      pending: () => inbox.length,
      close(code, reason) {
        if (code === undefined) ws.close();
        else ws.close(code, reason);
        return closed;
      },
    };

    ws.addEventListener('open', () => {
      opened = true;
      resolve(client);
    });
    ws.addEventListener('message', (event) => {
      const message = json ? JSON.parse(event.data) : event.data;
      const waiter = waiting.findIndex((w) => w.test(message));
      if (waiter !== -1) waiting.splice(waiter, 1)[0].resolve(message);
      else inbox.push(message);
    });
    ws.addEventListener('close', (event) => {
      const info = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      if (!opened) reject(Object.assign(new Error('could not connect'), info));
      onClosed(info);
    });
    ws.addEventListener('error', () => {}); // a 'close' event follows every error
  });
}

module.exports = { connect, sleep };
