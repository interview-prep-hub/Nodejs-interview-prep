// SOLID in plain JavaScript: one tiny before/after for each of the five principles
// Run: node lessons/25-architecture-and-patterns/examples/03-solid.js

// ======================================================================
// S - Single responsibility: a module should have ONE reason to change.
// ======================================================================
console.log('--- S: single responsibility');
// Before: one function that calculates, formats AND saves. Three reasons to change.
//   function processInvoice(items) { total...; text...; fs.writeFileSync(...) }
// After: three small pieces, each easy to test alone.
const invoiceTotal = (items) => items.reduce((sum, i) => sum + i.price * i.qty, 0);
const invoiceText = (items) => items.map((i) => `${i.qty} x ${i.name}`).join(', ') + ` = ${invoiceTotal(items)}`;
const saveInvoice = (store, text) => store.push(text); // the "storage" is injected
const stored = [];
saveInvoice(stored, invoiceText([{ name: 'pen', price: 2, qty: 3 }, { name: 'book', price: 10, qty: 1 }]));
console.log(stored);

// ======================================================================
// O - Open/closed: open for extension, closed for modification.
// ======================================================================
console.log('\n--- O: open/closed');
// Before: an if/else ladder. Every new discount means editing price().
//   if (type === 'student') ...; else if (type === 'vip') ...
// After: price() never changes. New discounts are ADDED to a registry.
const discounts = new Map([
  ['none', (p) => p],
  ['student', (p) => p * 0.9],
]);
const price = (base, type) => (discounts.get(type) ?? discounts.get('none'))(base);
console.log('student:', price(100, 'student'));
discounts.set('blackfriday', (p) => p * 0.5); // extension: no existing code touched
console.log('blackfriday:', price(100, 'blackfriday'));

// ======================================================================
// L - Liskov substitution: a subtype must work wherever its parent works.
// ======================================================================
console.log('\n--- L: Liskov substitution');
class Storage {
  read(name) {
    return `contents of ${name}`;
  }
  write(name, data) {
    return `wrote ${data.length} chars to ${name}`;
  }
}
// BAD: a "read-only storage" that throws on write(). Code written for Storage breaks.
class ReadOnlyStorage extends Storage {
  write() {
    throw new Error('read only!');
  }
}
const backup = (storage) => storage.write('backup.txt', 'data');
console.log(backup(new Storage()));
try {
  backup(new ReadOnlyStorage());
} catch (err) {
  console.log('subtype broke the caller:', err.message);
}
// Better: do not inherit. Make two small shapes, and ask only for the one you need.
const makeReadOnly = () => ({ read: (name) => `contents of ${name}` }); // has no write() at all
console.log('read-only still works for reading:', makeReadOnly().read('a.txt'));

// ======================================================================
// I - Interface segregation: do not force code to depend on methods it does not use.
// ======================================================================
console.log('\n--- I: interface segregation');
// JavaScript has no "interface" keyword. The "interface" is just the methods a function actually calls.
// This function needs ONLY get(). So any object with get() is accepted, big or small.
const greet = (cache, id) => `hello ${cache.get(id) ?? 'stranger'}`;
console.log(greet({ get: (id) => (id === 1 ? 'Ada' : undefined) }, 1)); // a 1-method fake
console.log(greet(new Map([[2, 'Bob']]), 2)); // a Map also has get()
// A "big interface" (get, set, delete, clear, keys, flush, stats...) would force every fake to implement all of them.

// ======================================================================
// D - Dependency inversion: depend on a small contract, not on a concrete tool.
// ======================================================================
console.log('\n--- D: dependency inversion');
// The high-level class knows only "a notifier has send(text)". It does not import an email or SMS library.
class OrderService {
  constructor({ notifier }) {
    this.notifier = notifier;
  }
  place(order) {
    this.notifier.send(`order ${order.id} placed`);
    return 'ok';
  }
}
const emailNotifier = { send: (text) => console.log('  email:', text) };
const smsNotifier = { send: (text) => console.log('  sms  :', text) };
new OrderService({ notifier: emailNotifier }).place({ id: 1 });
new OrderService({ notifier: smsNotifier }).place({ id: 2 });
