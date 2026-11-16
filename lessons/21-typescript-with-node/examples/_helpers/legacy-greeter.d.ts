// A declaration file (.d.ts) describes JavaScript that already exists. It contains types only, no code.
// Imagine "legacy-greeter" is an old npm package written in plain JavaScript with no types.
// This file tells TypeScript what its exports look like. (Node never loads a .d.ts file.)
declare module 'legacy-greeter' {
  export function greet(name: string, loud?: boolean): string;
  export const version: string;
}
