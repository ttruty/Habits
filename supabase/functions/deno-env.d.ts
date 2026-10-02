// For the browser/Vitest TypeScript check only: the slice of Deno the shared modules touch.
// Deno itself never loads this file (nothing imports it).
declare const Deno: { env: { get(name: string): string | undefined } };
