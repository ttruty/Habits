// Fails if what a host page loads for the embed is over budget (CLAUDE.md: under 25 KB gzipped):
// dist/embed.js plus every chunk it imports statically. Dynamic import() chunks (the correction
// dialog, which the read-only embed never opens) aren't loaded, so they don't count.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 25 * 1024;
const kb = (n) => (n / 1024).toFixed(1);

function staticGraph(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const code = readFileSync(file, 'utf8');
  for (const [, spec] of code.matchAll(
    /(?:^|[;\n}])\s*import\s*(?:[^'"()]*?\s*from\s*)?["'](\.[^"']+)["']/g,
  )) {
    staticGraph(join(dirname(file), spec), seen);
  }
  return seen;
}

const files = [...staticGraph('dist/embed.js')];
let total = 0;
for (const f of files) {
  const size = gzipSync(readFileSync(f), { level: 9 }).length;
  total += size;
  console.log(`  ${f}: ${kb(size)} KB`);
}
console.log(`embed (what a host page loads): ${kb(total)} KB gzipped (limit ${kb(LIMIT)} KB)`);
if (total > LIMIT) {
  console.error('Embed bundle is over budget.');
  process.exit(1);
}
