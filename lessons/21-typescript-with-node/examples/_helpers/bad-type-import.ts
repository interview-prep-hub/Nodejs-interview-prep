// Helper: this file is meant to FAIL. Shape is an interface, so it does not exist at runtime,
// but this import asks for it as a value. The fix is: import type { Shape } from './shapes.ts';
import { Shape, area } from './shapes.ts';
const s: Shape = { kind: 'square', size: 2 };
console.log(area(s));
