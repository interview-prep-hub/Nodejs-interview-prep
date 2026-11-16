// EventEmitter basics: on, once, off, emit, prependListener, listenerCount, eventNames, removeAllListeners
// Run: node lessons/09-events/examples/01-basics.js

const EventEmitter = require('node:events');

const radio = new EventEmitter();

// on: add a listener (a function that runs every time the event is emitted)
function listenerA(song) {
  console.log('  A heard:', song);
}
radio.on('song', listenerA);
radio.on('song', (song) => console.log('  B heard:', song));

// once: runs one time, then removes itself
radio.once('news', (headline) => console.log('  once heard:', headline));

console.log('1. emit calls every listener');
const hadListeners = radio.emit('song', 'Blue');
console.log('  emit returned:', hadListeners);

console.log('2. once listeners run one time only');
radio.emit('news', 'First headline');
const second = radio.emit('news', 'Second headline');
console.log('  second emit returned:', second, '(nobody was listening any more)');

console.log('3. counting');
console.log('  listenerCount("song"):', radio.listenerCount('song'));
console.log('  eventNames():', radio.eventNames());

console.log('4. off removes a listener, but you need the SAME function');
radio.off('song', (song) => console.log('  B heard:', song)); // a new function, so nothing is removed
console.log('  after off with a look-alike function:', radio.listenerCount('song'));
radio.off('song', listenerA); // the real reference
console.log('  after off with the real function:', radio.listenerCount('song'));

console.log('5. prependListener puts a listener at the front');
radio.prependListener('song', (song) => console.log('  P heard first:', song));
radio.emit('song', 'Red');

console.log('6. methods return the emitter, so calls can be chained');
const sameObject = radio.on('weather', () => {}).on('traffic', () => {});
console.log('  chain returned the emitter:', sameObject === radio);
console.log('  eventNames():', radio.eventNames());

console.log('7. removeAllListeners');
radio.removeAllListeners('song');
console.log('  after removing "song":', radio.eventNames());
radio.removeAllListeners();
console.log('  after removing everything:', radio.eventNames());

console.log('8. emitting an event nobody listens to is silent');
console.log('  emit("Song") returned:', radio.emit('Song', 'typo in the name'));
