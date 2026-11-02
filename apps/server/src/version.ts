import { readFileSync } from 'node:fs';

// Resolves from both src/ (tsx) and dist/ (built), which sit side by side under apps/server.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const SERVER_VERSION: string = pkg.version;
