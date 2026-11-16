// Event sourcing, CQRS and the saga pattern in one small in-memory example
// Run: node lessons/25-architecture-and-patterns/examples/12-cqrs-events-saga.js

// ======================================================================
// EVENT SOURCING: store what HAPPENED (events), not just the latest state. State = replay of the events.
// ======================================================================
const eventStore = []; // append-only list: events are never edited or deleted
const subscribers = []; // who wants to hear about new events

function append(type, data) {
  const event = { version: eventStore.length + 1, type, data };
  eventStore.push(event);
  subscribers.forEach((fn) => fn(event));
  return event;
}

// Apply one event to the current state and return the new state.
function applyEvent(state, event) {
  switch (event.type) {
    case 'AccountOpened':
      return { id: event.data.accountId, balance: 0 };
    case 'MoneyDeposited':
      return { ...state, balance: state.balance + event.data.amount };
    case 'MoneyWithdrawn':
      return { ...state, balance: state.balance - event.data.amount };
    default:
      return state;
  }
}

// Rebuild an account by replaying its events (optionally only up to some version = "time travel").
const loadAccount = (accountId, upToVersion = Infinity) =>
  eventStore.filter((e) => e.data.accountId === accountId && e.version <= upToVersion).reduce(applyEvent, null);

// ======================================================================
// CQRS, write side: COMMANDS check the rules against the current state, then append events.
// ======================================================================
function handleCommand(cmd) {
  const account = loadAccount(cmd.accountId);
  switch (cmd.type) {
    case 'OpenAccount':
      if (account) throw new Error('account already exists');
      return append('AccountOpened', { accountId: cmd.accountId });
    case 'Deposit':
      if (!account) throw new Error('no such account');
      return append('MoneyDeposited', { accountId: cmd.accountId, amount: cmd.amount });
    case 'Withdraw':
      if (!account) throw new Error('no such account');
      if (account.balance < cmd.amount) throw new Error('insufficient funds');
      return append('MoneyWithdrawn', { accountId: cmd.accountId, amount: cmd.amount });
    default:
      throw new Error(`unknown command ${cmd.type}`);
  }
}

// ======================================================================
// CQRS, read side: a separate, query-friendly READ MODEL built from the events (a "projection").
// It is updated asynchronously, so it is eventually consistent.
// ======================================================================
function makeReadModel() {
  const balances = new Map();
  const statements = new Map();
  const project = (event) => {
    const { accountId, amount } = event.data;
    if (event.type === 'AccountOpened') {
      balances.set(accountId, 0);
      statements.set(accountId, []);
    } else {
      const signed = event.type === 'MoneyDeposited' ? amount : -amount;
      balances.set(accountId, balances.get(accountId) + signed);
      statements.get(accountId).push(`${signed > 0 ? '+' : ''}${signed}`);
    }
  };
  return { balances, statements, project };
}

const nextTurn = () => new Promise(setImmediate);

async function eventSourcingAndCqrs() {
  console.log('--- 1. Event sourcing + CQRS');
  const readModel = makeReadModel();
  // A message consumer: events reach the read model one event-loop turn LATER (like a queue would deliver them).
  subscribers.push((event) => setImmediate(() => readModel.project(event)));

  handleCommand({ type: 'OpenAccount', accountId: 'acc-1' });
  handleCommand({ type: 'Deposit', accountId: 'acc-1', amount: 100 });
  handleCommand({ type: 'Withdraw', accountId: 'acc-1', amount: 30 });
  try {
    handleCommand({ type: 'Withdraw', accountId: 'acc-1', amount: 500 });
  } catch (err) {
    console.log('  rejected command:', err.message);
  }

  console.log('  events stored:', eventStore.map((e) => `${e.version}:${e.type}`).join(', '));
  console.log('  read model right after the commands:', readModel.balances.get('acc-1'), '(stale: nothing projected yet)');
  await nextTurn();
  console.log('  read model one turn later          :', readModel.balances.get('acc-1'), '| statement:', readModel.statements.get('acc-1').join(' '));

  console.log('  state from replaying all events    :', loadAccount('acc-1'));
  console.log('  state as of version 2 (time travel):', loadAccount('acc-1', 2));

  const rebuilt = makeReadModel();
  eventStore.forEach(rebuilt.project);
  console.log('  new read model rebuilt from scratch:', rebuilt.balances.get('acc-1'), '(replay all events into a fresh projection)');
}

// ======================================================================
// SAGA: a business transaction across several services, without a distributed database transaction.
// Every step has a COMPENSATION (an "undo" that is a new business action). On failure, undo in reverse order.
// ======================================================================
async function runSaga(name, steps, context) {
  const completed = [];
  for (const step of steps) {
    try {
      await step.run(context);
      console.log(`    ${step.name}: done`);
      completed.push(step);
    } catch (err) {
      console.log(`    ${step.name}: FAILED (${err.message}) -> compensating`);
      for (const done of [...completed].reverse()) {
        await done.undo(context);
        console.log(`    undo ${done.name}`);
      }
      return `${name}: rolled back`;
    }
  }
  return `${name}: completed`;
}

async function sagaDemo() {
  console.log('\n--- 2. Saga (orchestrated): reserve stock -> charge card -> ship');
  const makeSteps = (failAt) => [
    { name: 'reserve stock', run: async () => {}, undo: async () => {} },
    {
      name: 'charge card',
      run: async () => {
        if (failAt === 'charge card') throw new Error('card declined');
      },
      undo: async () => {}, // in real life: refund
    },
    {
      name: 'create shipment',
      run: async () => {
        if (failAt === 'create shipment') throw new Error('courier API is down');
      },
      undo: async () => {},
    },
  ];
  for (const failAt of [null, 'charge card', 'create shipment']) {
    console.log(`  scenario: ${failAt ? `${failAt} fails` : 'everything works'}`);
    console.log('   ', await runSaga('order-1001', makeSteps(failAt), {}));
  }
}

async function main() {
  await eventSourcingAndCqrs();
  await sagaDemo();
}

main();
