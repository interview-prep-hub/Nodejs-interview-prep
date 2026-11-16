// Helper used by the examples: exports both types and values.
// Types are erased at runtime, so only `area` and `UNIT` exist in the JavaScript that runs.

export interface Shape {
  kind: 'circle' | 'square';
  size: number;
}

export type ShapeKind = Shape['kind'];

export const UNIT = 'cm2';

export function area(shape: Shape): number {
  return shape.kind === 'circle' ? Math.PI * shape.size ** 2 : shape.size ** 2;
}
