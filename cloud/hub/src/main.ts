// Starts DinePOS Cloud. Environment:
//   HUB_PORT (default 4900), HUB_HOST (default 0.0.0.0), HUB_DATA_DIR (default ./hub-data)
//   HUB_ADMIN_KEY      required for the admin page (/admin) and /v1/admin (stores, pairing codes, devices, settings)
//   HUB_PUBLIC_URL     the hub's https address as shops reach it, used in connection links (else taken from the admin's browser)
//   HUB_DEV_OTP=1      return OTP codes in responses (development and the demo page only; never in production)
//   HUB_ROUTING_URL    optional OSRM-compatible server for real road distances (else each store's road factor);
//                      only the starting value: a routing server saved on the admin page wins
//   HUB_ONLINE_PAYMENTS=1  online payment (phase 3; needs a payment gateway)
//   HUB_DEVICE_DOMAIN  P6-02: devices reach an outlet at https://<store>.<this domain> (default: the host of HUB_PUBLIC_URL)
//   HUB_OUTLET_SERVER  P6-04: the DinePOS server for hosted outlets (default: ../../outlet-server/server.mjs in this repository)
//   HUB_TIMEZONE       P6-04: hosted outlets' time zone (default Asia/Kolkata)
//   HUB_BREVO_API_KEY, HUB_MAIL_FROM (+ HUB_MAIL_FROM_NAME)  P7-01: email for customer accounts (Brevo). Not set: sign-up is closed
//   HUB_LICENCE_SIGNING_KEY_FILE  P7-02: the cloud's licence signing key (PEM; default <HUB_DATA_DIR>/licence-signing-key.pem if there)
//   HUB_MAX_DEMOS      P7-04: browser demos running at once (default 10); HUB_DEMO_SEED: the sample outlet (default ../../outlet-server/demo-seed.json)
//   HUB_DEV_MAIL=1     P7-01: development only: no email provider, codes go to this log and sign-up is open
//   HUB_ALERT_WEBHOOK  Slack / Discord / Google Chat webhook for alerts (hosted outlet down, backups failing)
//   GITHUB_TOKEN       P8-04: optional; the downloads list reads GitHub Releases (60 requests an hour without it, 10-minute cache)
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hub } from './hub.ts';
import { createHubServer } from './http.ts';
import { UrbanPiper } from './urbanpiper.ts';
import { HostedOutlets } from './hosted.ts';
import { Monitor } from './monitor.ts';
import { mailerFromEnv } from './mailer.ts';
import { Downloads } from './downloads.ts';

const dir = process.env.HUB_DATA_DIR ?? './hub-data';
mkdirSync(dir, { recursive: true });
function signingKeyFile(): string | undefined {
  const f = process.env.HUB_LICENCE_SIGNING_KEY_FILE || join(dir, 'licence-signing-key.pem');
  return existsSync(f) ? f : undefined;
}
const log = { info: (m: string, d?: unknown) => console.log(new Date().toISOString(), m, d ?? ''), warn: (m: string, d?: unknown) => console.warn(new Date().toISOString(), m, d ?? '') };
const hub = new Hub({
  dbPath: join(dir, 'hub.db'), devOtp: process.env.HUB_DEV_OTP === '1', onlinePayments: process.env.HUB_ONLINE_PAYMENTS === '1', log,
  settingDefaults: { routingUrl: process.env.HUB_ROUTING_URL ?? '' },
  mailer: mailerFromEnv(process.env, log), licenceSigningKey: signingKeyFile(), allowLogMailer: process.env.HUB_DEV_MAIL === '1',
});
if (!process.env.HUB_ADMIN_KEY) log.warn('HUB_ADMIN_KEY is not set: store admin is disabled (use scripts/admin.ts on this machine)');
else log.info('hub admin page: /admin');
const urbanpiper = new UrbanPiper(hub, { log }); // Swiggy / Zomato (set up per store on the admin page)
// P6-04: outlets with no main PC: their DinePOS server runs here, one per outlet, data in <HUB_DATA_DIR>/outlets
const hosted = new HostedOutlets(hub, {
  serverEntry: process.env.HUB_OUTLET_SERVER ?? join(import.meta.dirname, '..', '..', 'outlet-server', 'server.mjs'),
  dataRoot: join(dir, 'outlets'),
  timeZone: process.env.HUB_TIMEZONE ?? 'Asia/Kolkata',
  log,
});
hosted.start();
// alerts: hosted outlets down, backups failing (deploy/backup.sh writes backup-status.json every hour)
const monitor = new Monitor(hub, { hosted, backupStatusFile: join(dir, 'backup-status.json'), webhook: process.env.HUB_ALERT_WEBHOOK || undefined, log });
const watcher = setInterval(() => void monitor.tick().catch((e) => log.warn('monitor failed', String(e))), 30_000);
watcher.unref();
const outletServerDir = join(import.meta.dirname, '..', '..', 'outlet-server');
// P8-04: Windows downloads from the newest GitHub Releases (GITHUB_TOKEN optional: more API requests an hour)
const downloads = new Downloads(hub.db, { githubToken: process.env.GITHUB_TOKEN || undefined, log });
const server = createHubServer(hub, { downloads, demo: { seed: process.env.HUB_DEMO_SEED ?? join(outletServerDir, 'demo-seed.json'), max: Number(process.env.HUB_MAX_DEMOS ?? 10) || 10 }, hosted, monitor, adminKey: process.env.HUB_ADMIN_KEY, publicUrl: process.env.HUB_PUBLIC_URL || undefined, deviceDomain: process.env.HUB_DEVICE_DOMAIN || undefined, urbanpiper });
const sweeper = setInterval(() => { try { hub.sweep(); } catch (e) { log.warn('sweep failed', String(e)); } void urbanpiper.pump().catch((e) => log.warn('urbanpiper outbox failed', String(e))); }, 5000);
// P7-04: browser demos past their 72 hours are stopped and deleted
const demoSweeper = setInterval(() => void server.demos?.sweep().catch((e) => log.warn('demo sweep failed', String(e))), 60_000);
demoSweeper.unref();
const port = Number(process.env.HUB_PORT ?? 4900);
server.listen(port, process.env.HUB_HOST ?? '0.0.0.0', () => log.info(`DinePOS Cloud on http://localhost:${port} (data: ${dir})`));
const stop = () => { clearInterval(sweeper); server.close(); server.closeAllConnections(); void hosted.stop().finally(() => { hub.close(); process.exit(0); }); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
