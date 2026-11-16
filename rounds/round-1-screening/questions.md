# Round 1: Screening and Fundamentals: Questions

How to use this file: read a question, answer it ALOUD in 30 to 60 seconds, then compare with [answers.md](answers.md). Tags: `[Easy]`, `[Medium]`, `[Hard]`. `[Must-know]` marks questions asked in almost every screening call. Score yourself green (nailed it), yellow (partly) or red (missed). Re-do the red ones tomorrow.

---

## Node.js basics (Lesson 01)

Lesson: [01 Introduction](../../lessons/01-introduction/README.md)

### R1-NODE-01 [Easy] [Must-know] What is Node.js, and what is it not?

### R1-NODE-02 [Easy] [Must-know] How is Node.js different from running JavaScript in a browser?

### R1-NODE-03 [Easy] [Must-know] Your JavaScript runs on one thread. How can Node.js still serve thousands of connections?

### R1-NODE-04 [Easy] What are V8 and libuv, and what does each one do?

### R1-NODE-05 [Easy] What does LTS mean, and which Node.js version should you run in production?

### R1-NODE-06 [Medium] When is Node.js a good choice, and when is it a poor one?

---

## JavaScript essentials (Lesson 02)

Lesson: [02 JavaScript essentials](../../lessons/02-javascript-essentials/README.md)

### R1-JS-01 [Easy] [Must-know] What is the difference between `var`, `let` and `const`?

### R1-JS-02 [Easy] [Must-know] What is a closure? Give a practical use.

### R1-JS-03 [Easy] [Must-know] What is the difference between `==` and `===`?

### R1-JS-04 [Medium] [Must-know] How is `this` decided, and how do arrow functions differ?

### R1-JS-05 [Medium] What is a prototype, and how does prototypal inheritance work?

### R1-JS-06 [Easy] What are `map`, `filter` and `reduce` for?

### R1-JS-07 [Medium] What is the difference between a shallow copy and a deep copy? How do you deep copy in modern Node.js?

---

## Modules and npm (Lessons 03, 04)

Lessons: [03 Modules](../../lessons/03-modules/README.md), [04 npm and package.json](../../lessons/04-npm-and-package-json/README.md)

### R1-MOD-01 [Easy] [Must-know] What is the difference between CommonJS and ES modules?

### R1-MOD-02 [Medium] What is the difference between `exports` and `module.exports`?

### R1-NPM-01 [Easy] [Must-know] What is the difference between `dependencies` and `devDependencies`?

### R1-NPM-02 [Medium] [Must-know] What does `package-lock.json` do, and how is `npm ci` different from `npm install`?

### R1-NPM-03 [Easy] What do `^1.2.3` and `~1.2.3` mean in package.json?

---

## Async JavaScript (Lesson 07)

Lesson: [07 Async JavaScript](../../lessons/07-async-javascript/README.md)

### R1-ASY-01 [Easy] [Must-know] What problem do callbacks, promises and async/await each solve?

### R1-ASY-02 [Medium] [Must-know] What is the difference between `Promise.all`, `Promise.allSettled`, `Promise.race` and `Promise.any`?

### R1-ASY-03 [Easy] [Must-know] How do you handle errors with async/await?

### R1-ASY-04 [Medium] Why can `await` inside a `for` loop be slow, and how do you run the work in parallel?

### R1-ASY-05 [Medium] What is an unhandled promise rejection, and what does current Node.js do about it?

---

## Core modules, HTTP and errors (Lessons 05, 06, 09, 12, 14)

Lessons: [05 Core modules](../../lessons/05-core-modules-tour/README.md), [06 File system](../../lessons/06-file-system/README.md), [09 Events](../../lessons/09-events/README.md), [12 HTTP](../../lessons/12-http-and-networking/README.md), [14 Errors](../../lessons/14-error-handling-and-debugging/README.md)

### R1-CORE-01 [Easy] [Must-know] `fs.readFile` or `fs.createReadStream`: when do you use which?

### R1-CORE-02 [Easy] How do you read environment variables and command line arguments?

### R1-CORE-03 [Easy] What is an `EventEmitter`? Show a tiny example.

### R1-CORE-04 [Easy] Why use `path.join` instead of string concatenation?

### R1-HTTP-01 [Easy] [Must-know] Write a minimal HTTP server using only core modules.

### R1-HTTP-02 [Easy] [Must-know] Which HTTP status codes do you use every day, and what do they mean?

### R1-HTTP-03 [Medium] What are the HTTP methods for, and what does "idempotent" mean?

### R1-ERR-01 [Easy] What is the difference between operational errors and programmer errors?

### R1-ERR-02 [Medium] What happens when an exception is thrown and nobody catches it? What should you do about it?

---

## Predict the output (Lessons 02, 07, 08)

Say the exact output, then say WHY. Run it afterwards to check.

### R1-OUT-01 [Easy] What does this print?

```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log('var', i), 0);
for (let j = 0; j < 3; j++) setTimeout(() => console.log('let', j), 0);
```

### R1-OUT-02 [Easy] What does this print?

```js
console.log(typeof f, typeof g);
function f() {}
var g = function () {};
try { console.log(h); } catch (e) { console.log(e.name); }
let h = 1;
```

### R1-OUT-03 [Medium] [Must-know] In what order do these lines print?

```js
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

### R1-OUT-04 [Medium] What does this print when run as a normal CommonJS file (`node file.js`)?

```js
const obj = { name: 'a', regular() { return this.name; }, arrow: () => typeof this };
console.log(obj.regular(), obj.arrow());
const f = obj.regular;
console.log(f());
```

### R1-OUT-05 [Medium] What does this print?

```js
async function a() { console.log(1); await b(); console.log(2); }
async function b() { console.log(3); }
a();
Promise.resolve().then(() => console.log(4));
console.log(5);
```

### R1-OUT-06 [Easy] What does this print?

```js
console.log(0.1 + 0.2, 0.1 + 0.2 === 0.3, [] + [], [] == false, typeof null, NaN === NaN, [1, 2, 3].map(parseInt));
```

---

## Coding challenges (hands-on)

These are practised on a keyboard, not answered aloud. Each card names a folder under `challenges/` with a README, a starter file and automated tests.

### R1-CODE-01 [Easy] Write your own promisify

Turn an error-first callback function into one that returns a promise. Skills: closures, `this`, promises. Time box: 15 minutes.
Folder: [challenges/01-promisify](challenges/01-promisify/README.md). Run: `npm run challenge -- promisify`
