// An ES module that decides what require() returns, using the export name 'module.exports'.
export const named = 'a named export';

function makeGreeting(name) {
  return `Hello, ${name}`;
}

export default makeGreeting;
export { makeGreeting as 'module.exports' };
