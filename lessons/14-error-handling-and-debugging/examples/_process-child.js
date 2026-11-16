// Helper for 06-process-handlers.js: runs ONE failure scenario chosen by the first argument.
// Run: node lessons/14-error-handling-and-debugging/examples/_process-child.js reject
// (Many scenarios crash on purpose. Look at the exit code with: echo $? in bash, or $LASTEXITCODE in PowerShell.)

const EventEmitter = require('node:events');

const scenario = process.argv[2];

// Every scenario schedules a timer. If "timer ran" is printed, the process survived the failure.
setTimeout(() => console.log('timer ran'), 50);

process.on('exit', (code) => console.log(`exit event, code ${code}`));

switch (scenario) {
  case 'throw':
    throw new Error('top-level throw');

  case 'reject':
    Promise.reject(new Error('rejected and nobody handled it'));
    break;

  case 'reject-string':
    Promise.reject('a plain string, not an Error');
    break;

  case 'reject-handler':
    process.on('unhandledRejection', (reason) => console.log(`unhandledRejection handler: ${reason.message}`));
    Promise.reject(new Error('rejected but a handler exists'));
    break;

  case 'reject-late': {
    process.on('unhandledRejection', (reason) => console.log(`unhandledRejection: ${reason.message}`));
    process.on('rejectionHandled', () => console.log('rejectionHandled: a catch was attached later'));
    const p = Promise.reject(new Error('handled too late'));
    setTimeout(() => p.catch(() => {}), 10);
    break;
  }

  case 'timer-throw-handler':
    process.on('uncaughtException', (err, origin) => console.log(`uncaughtException handler: ${err.message} (${origin})`));
    setTimeout(() => {
      throw new Error('thrown inside a timer');
    }, 10);
    break;

  case 'reject-via-uncaught':
    // With an uncaughtException handler, an unhandled rejection is routed to it (default mode).
    process.on('uncaughtException', (err, origin) => console.log(`uncaughtException handler: ${err.message} (${origin})`));
    Promise.reject(new Error('rejection with only an uncaughtException handler'));
    break;

  case 'monitor':
    // The monitor only observes. The process still crashes.
    process.on('uncaughtExceptionMonitor', (err, origin) => console.log(`monitor saw: ${err.message} (${origin})`));
    setTimeout(() => {
      throw new Error('crash after the monitor looked');
    }, 10);
    break;

  case 'log-then-exit':
    process.on('uncaughtException', (err) => {
      console.log(`fatal: ${err.message}`);
      process.exit(1); // do not carry on after an unknown failure
    });
    setTimeout(() => {
      throw new Error('unknown failure');
    }, 10);
    break;

  case 'emitter-error':
    new EventEmitter().emit('error', new Error('emitter error with no listener'));
    break;

  case 'exit-code':
    process.exitCode = 3; // a normal finish, but with a chosen code
    break;

  default:
    console.log(`unknown scenario: ${scenario}`);
    process.exitCode = 2;
}
