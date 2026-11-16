// Helper (not run by itself): the child script that example 11 starts with child_process.fork().
// It announces itself, answers one kind of question, and leaves when asked.

process.send({
  type: 'ready',
  pid: process.pid,
  ppid: process.ppid,
  sees: String(globalThis.shared), // a global variable the parent set on itself
});

process.on('message', (msg) => {
  if (msg === 'exit') {
    process.exit(0);
  } else {
    // Report what kind of values arrived after serialization.
    process.send({ type: 'kinds', mapIsMap: msg.map instanceof Map, dateIsDate: msg.date instanceof Date });
  }
});
