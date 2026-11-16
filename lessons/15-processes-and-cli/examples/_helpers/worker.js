// Helper (not run by itself): a child started with fork(). It talks to its parent with messages.
// Used by 07-sync-and-fork.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/worker.js   (without a parent there is no IPC channel)

if (!process.send) {
  console.log('No parent started me with fork(), so process.send does not exist.');
  process.exit(0);
}

process.on('message', (message) => {
  if (message.type === 'add') {
    // Pretend this is slow, CPU heavy work that you do not want in the parent.
    process.send({ type: 'result', value: message.a + message.b });
  } else if (message.type === 'inspect') {
    // Report what arrived, to show what the serializer kept.
    process.send({
      type: 'inspected',
      mapKept: message.map instanceof Map,
      dateKept: message.date instanceof Date,
      dateType: typeof message.date,
      bigintType: typeof message.big,
    });
  } else if (message.type === 'bye') {
    process.disconnect(); // close the channel; with nothing else to do, this process exits by itself
  }
});

process.send({ type: 'ready', hasChannel: process.connected });
