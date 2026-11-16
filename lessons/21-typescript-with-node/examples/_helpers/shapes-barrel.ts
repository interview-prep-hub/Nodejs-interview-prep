// Helper used by example 12: a "barrel" file that re-exports from shapes.ts.
// Type-only re-exports must say "export type", for the same reason imports must say "import type".
export type { Shape, ShapeKind } from './shapes.ts';
export { area, UNIT } from './shapes.ts';
