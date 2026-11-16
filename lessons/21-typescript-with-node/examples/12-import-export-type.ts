// import type and export type: telling Node which names are only types
// Shows: the correct import forms, the .ts extension, and proof that types do not exist at runtime
// Run: node lessons/21-typescript-with-node/examples/12-import-export-type.ts

// 1. Mix values and types in one import. The "type" keyword marks the names that are erased.
import { area, UNIT, type Shape, type ShapeKind } from './_helpers/shapes.ts';

// 2. Or mark the whole statement as type-only. The entire line disappears at runtime.
import type { Server } from 'node:http';

// 3. A namespace import lets us look at what really exists at runtime.
import * as shapes from './_helpers/shapes.ts';

// 4. Re-exports through a barrel file need "export type" for types, for the same reason.
import * as barrel from './_helpers/shapes-barrel.ts';

const square: Shape = { kind: 'square', size: 3 };
const kind: ShapeKind = 'circle';
console.log('1.', `area of the square: ${area(square)} ${UNIT}`, '| a kind:', kind);

// "Server" is only used as a type here. No import of node:http happens at runtime.
function describeServer(server: Server | null): string {
  return server ? 'has a server' : 'no server yet';
}
console.log('2.', describeServer(null));

// Types are not real values, so they are NOT in the runtime module object.
console.log('3. runtime exports of shapes.ts:', Object.keys(shapes));
console.log('4. runtime exports of the barrel:', Object.keys(barrel));

// You can also export types from your own file. The exported name vanishes at runtime.
export type Summary = { shape: Shape; area: number };
export const summary: Summary = { shape: square, area: area(square) };
console.log('5.', summary);
