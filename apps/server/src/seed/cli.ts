// `npm run seed -w @dinepos/server`: sends the dev seed to a RUNNING server as normal commands, so the
// single-writer rule holds (this script never opens the database). DEVELOPMENT ONLY.
import { newId, type CommandResponse } from '@dinepos/shared';
import { devSeedCommands } from './dev-seed.js';

const server = (process.env.DINEPOS_URL ?? 'http://127.0.0.1:7420').replace(/\/$/, '');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production.');
  let created = 0;
  let updated = 0;
  for (const cmd of devSeedCommands()) {
    const res = await fetch(`${server}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: newId(), type: cmd.type, payload: cmd.payload, createdAt: new Date().toISOString() }),
    });
    const body = (await res.json()) as CommandResponse<{ created: boolean }>;
    if (!body.ok) throw new Error(`${cmd.type} failed: ${body.error.code} ${body.error.message} ${JSON.stringify(body.error.details ?? '')}`);
    if (body.result.created) created++;
    else updated++;
  }
  console.warn(`Seed done against ${server}: ${created} created, ${updated} already present (updated in place).`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg.includes('fetch failed') ? `Cannot reach ${server}. Start it with: npm run dev:server` : msg);
  process.exit(1);
});
