// Copies non-TypeScript runtime files (SQL migrations) next to the compiled output.
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
const to = fileURLToPath(new URL('../dist/db/migrations/', import.meta.url));
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.ts') });
console.warn(`copied migrations -> ${to}`);
