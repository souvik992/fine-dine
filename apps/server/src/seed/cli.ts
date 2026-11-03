// `npm run seed -w @dinepos/server`: sends the dev seed to a RUNNING server as normal commands, so the
// single-writer rule holds (this script never opens the database). DEVELOPMENT ONLY: it creates staff with
// well-known PINs (owner 1234, manager 2345, cashier 1111, captain 3333).
import { newId, type CommandResponse, type LoginResult, type SetupState } from '@dinepos/shared';
import { DEV_OWNER, devSeedCommands, devSetupCommand } from './dev-seed.js';

const server = (process.env.DINEPOS_URL ?? 'http://127.0.0.1:7420').replace(/\/$/, '');
/** From another PC (or a server that does not trust loopback): a paired device token (P2-02). */
const device: Record<string, string> = process.env.DINEPOS_DEVICE_TOKEN ? { authorization: `Device ${process.env.DINEPOS_DEVICE_TOKEN}` } : {};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${server}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...device } });
  const body = (await res.json()) as T & { ok?: boolean; error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`${path}: ${body.error?.code ?? res.status} ${body.error?.message ?? ''}`);
  return body;
}

async function command(type: string, payload: unknown, token?: string): Promise<CommandResponse<{ created?: boolean }>> {
  return json('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-user-session': token } : {}) },
    body: JSON.stringify({ commandId: newId(), type, payload, createdAt: new Date().toISOString() }),
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production.');
  const state = await json<SetupState>('/v1/setup-state');
  if (state.setupNeeded) {
    const s = devSetupCommand();
    await command(s.type, s.payload);
  }
  const session = await json<LoginResult>('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: DEV_OWNER.id, pin: DEV_OWNER.pin }),
  }).catch(() => {
    throw new Error('Could not sign in as the demo owner (PIN 1234). This server was set up by someone else; seed a fresh data folder.');
  });

  let created = 0;
  let updated = 0;
  for (const cmd of devSeedCommands()) {
    const body = await command(cmd.type, cmd.payload, session.token);
    if (!body.ok) throw new Error(`${cmd.type} failed: ${body.error.code} ${body.error.message}`);
    if (body.result.created === true) created++;
    else if (body.result.created === false) updated++;
  }
  await fetch(`${server}/v1/session`, { method: 'DELETE', headers: { 'x-user-session': session.token, ...device } });
  console.warn(`Seed done against ${server}: ${created} created, ${updated} already present (updated in place).`);
  console.warn('Demo sign-in PINs (development only): owner 1234, manager 2345, cashier 1111, captain 3333.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg.includes('fetch failed') ? `Cannot reach ${server}. Start it with: npm run dev:server` : msg);
  process.exit(1);
});
