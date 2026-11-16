// Prototypes, the prototype chain, and classes (which are built on prototypes)
// Run: node lessons/02-javascript-essentials/examples/04-prototypes-classes.js

// 1. Every object has a hidden link to another object: its prototype.
//    A missing property is looked up by walking up this chain.
const animal = {
  eats: true,
  speak() {
    return 'some sound';
  },
};
const dog = Object.create(animal); // dog's prototype is animal
dog.barks = true;
console.log('1a.', dog.eats, dog.speak());
console.log('1b.', Object.getPrototypeOf(dog) === animal);
console.log('1c.', Object.keys(dog), '| "eats" in dog:', 'eats' in dog, '| own "eats":', Object.hasOwn(dog, 'eats'));

// 2. Every chain ends at Object.prototype, and then null.
const top = Object.getPrototypeOf(Object.getPrototypeOf(dog));
console.log('2.  top is Object.prototype:', top === Object.prototype, '| after that:', Object.getPrototypeOf(top));

// 3. Writing makes an OWN property that hides (shadows) the inherited one.
dog.eats = false;
console.log('3.  dog.eats:', dog.eats, '| animal.eats:', animal.eats);

// 4. The old way: a constructor function plus its .prototype object.
function Car(brand) {
  this.brand = brand;
}
Car.prototype.drive = function () {
  return this.brand + ' drives';
};
const fiat = new Car('Fiat');
const kia = new Car('Kia');
console.log('4a. ', fiat.drive(), '| same function shared:', fiat.drive === kia.drive);
console.log('4b. ', fiat.constructor === Car, Object.getPrototypeOf(fiat) === Car.prototype);

// Trap: for...in also lists enumerable properties inherited from the prototype.
const keysIn = [];
for (const key in fiat) keysIn.push(key);
console.log('4c.  for...in:', keysIn, '| Object.keys:', Object.keys(fiat));

// 5. A class is the same machinery with cleaner syntax.
class Animal {
  static count = 0; // belongs to the class itself, not to instances
  #energy = 10; // private field: only code inside this class body can read it

  constructor(name) {
    this.name = name;
    Animal.count += 1;
  }

  speak() {
    return `${this.name} makes a sound`;
  }

  get energy() {
    return this.#energy;
  }

  set energy(value) {
    if (value < 0) throw new RangeError('energy cannot be negative');
    this.#energy = value;
  }

  static create(name) {
    return new this(name); // "this" is the class that was called: Animal or a subclass
  }

  static hasEnergy(obj) {
    return #energy in obj; // brand check: does this object have the private field?
  }
}

class Dog extends Animal {
  constructor(name, breed) {
    super(name); // must run before "this" can be used
    this.breed = breed;
  }

  speak() {
    return super.speak() + ' (woof)'; // call the parent version
  }
}

const rex = new Dog('Rex', 'Collie');
console.log('5a. ', rex.speak());
console.log('5b. ', rex.energy);
rex.energy = 4;
console.log('5c. ', rex.energy);
try {
  rex.energy = -1;
} catch (err) {
  console.log('5d. ', err.name + ':', err.message);
}

// 6. The sugar is visible if you look.
console.log('6a. ', typeof Animal, '| Dog.prototype inherits Animal.prototype:', Object.getPrototypeOf(Dog.prototype) === Animal.prototype);
console.log('6b. ', 'static inheritance, Object.getPrototypeOf(Dog) === Animal:', Object.getPrototypeOf(Dog) === Animal);
console.log('6c. ', Object.keys(rex), '| methods live on the prototype:', Object.getOwnPropertyNames(Animal.prototype));
console.log('6d. ', rex instanceof Dog, rex instanceof Animal, rex instanceof Object);
console.log('6e. ', Dog.create('Fido') instanceof Dog, '| count:', Animal.count, '| rex.count:', rex.count);
console.log('6f. ', Animal.hasEnergy(rex), Animal.hasEnergy({}), '| JSON:', JSON.stringify(rex));

// 7. What a class does that a plain function does not.
try {
  Animal('no new');
} catch (err) {
  console.log('7a. ', err.name + ':', err.message);
}

try {
  new Later();
} catch (err) {
  console.log('7b. ', err.name + ':', err.message);
}
class Later {}

class BadChild extends Animal {
  constructor() {
    this.x = 1; // forgot super() first
  }
}
try {
  new BadChild();
} catch (err) {
  console.log('7c. ', err.name + ':', err.message);
}

// 8. Trap: a method passed around loses this. An arrow class field fixes that,
//    but every instance then gets its own copy of the function.
class Button {
  label = 'OK';
  clickMethod() {
    return this?.label; // when detached, this is undefined, so ?. avoids a crash
  }
  clickArrow = () => this.label;
}
const b1 = new Button();
const b2 = new Button();
const { clickMethod, clickArrow } = b1;
console.log('8a. ', clickMethod(), clickArrow());
console.log('8b. method shared:', b1.clickMethod === b2.clickMethod, '| arrow shared:', b1.clickArrow === b2.clickArrow);

// 9. What "new" does, written by hand (a classic interview task).
function myNew(Constructor, ...args) {
  const obj = Object.create(Constructor.prototype); // 1. a new object linked to Constructor.prototype
  const result = Constructor.apply(obj, args); //      2. run the constructor with this = that object
  const isObject = (typeof result === 'object' && result !== null) || typeof result === 'function';
  return isObject ? result : obj; //                   3. an object returned by the constructor wins
}
const hand = myNew(Car, 'Fiat');
console.log('9a. ', hand.drive(), '| instanceof Car:', hand instanceof Car, '| own keys:', Object.keys(hand));

// 10. "prototype" and "the prototype of" are two different things.
const fiat2 = new Car('Fiat');
console.log('10a.', 'Car.prototype is the object that new-made objects link to:', Object.getPrototypeOf(fiat2) === Car.prototype);
console.log('10b.', 'the instance has no property called prototype:', fiat2.prototype, '| the function has:', typeof Car.prototype);
console.log('10c.', 'the chain: fiat2 -> Car.prototype -> Object.prototype:', Object.getPrototypeOf(Car.prototype) === Object.prototype);

// 11. An object with no prototype at all: a safe dictionary (no "toString" or "constructor" keys by accident).
const dict = Object.create(null);
dict.apple = 1;
console.log('11. ', dict.toString, '| toString in {}:', 'toString' in {}, '| toString in dict:', 'toString' in dict, '|', dict);

// 12. More class features: private methods, static private fields and a static block.
class Ticket {
  static #issued = 0; // private AND static: one counter shared by the whole class
  static prefix;
  static {
    Ticket.prefix = 'T-'; // a static block: runs once, when the class is defined
  }

  #id = ++Ticket.#issued;

  #format() {
    return Ticket.prefix + String(this.#id).padStart(3, '0'); // a private method
  }

  label() {
    return this.#format();
  }
}
const t1 = new Ticket();
const t2 = new Ticket();
console.log('12. ', t1.label(), t2.label(), '| t1.format:', typeof t1.format, '| keys:', Object.keys(t1));
