// An ES module: several named exports and one default export.
console.log('  [shapes.mjs] the module code is running');

export const PI = 3.14159;

export function circleArea(radius) {
  return PI * radius * radius;
}

export function squareArea(side) {
  return side * side;
}

// The default export. A module can have at most one.
export default function describe(shape) {
  return `a ${shape}`;
}
