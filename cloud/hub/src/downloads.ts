import { exec, many, one } from './db.ts';
import type { Db } from './db.ts';
import { HubError } from './hub.ts';
import { PRODUCTS, type ProductCode } from './products.ts';

/**
 * The Windows downloads offered in the customer portal (P8-04, ADR-0007): each product's app and add-ons, always the
 * newest build. CI publishes a GitHub Release on every push to main (fine-dine: `dinepos-build-<n>`, tiffin:
 * `tiffin-build-<n>`); this reads those releases from the GitHub API, keeps the list in memory and in the database
 * (so the portal still lists downloads when GitHub cannot be reached), and records which signed-in account downloaded
 * what. An add-on missing from the newest release (its signing secret was not set for that build) comes from the
 * newest release that has it.
 */

export interface DownloadItem {
  id: string;
  product: ProductCode;
  kind: 'app' | 'addon';
  name: string;
  description: string;
  repo: string;
  tagPrefix: string;
  /** The installer's file name; group 1 is the version. */
  asset: RegExp;
}

export const CATALOGUE: readonly DownloadItem[] = [
  { id: 'dinepos', product: 'fine_dine', kind: 'app', name: 'DinePOS for Windows', description: 'Billing, tables, KOTs and the kitchen. Install it on the outlet’s main PC first.', repo: 'souvik992/fine-dine', tagPrefix: 'dinepos-build-', asset: /^DinePOS-Setup-(.+)\.exe$/ },
  { id: 'dinepos-tableqr', product: 'fine_dine', kind: 'addon', name: 'Table QR', description: 'Guests order and call a waiter from a QR code on the table. Install after DinePOS.', repo: 'souvik992/fine-dine', tagPrefix: 'dinepos-build-', asset: /^DinePOS-TableQR-Setup-(.+)\.exe$/ },
  { id: 'tiffin', product: 'tiffin_qsr', kind: 'app', name: 'Tiffin POS for Windows', description: 'Quick billing, kitchen tickets and stock for counter service.', repo: 'souvik992/tiffin', tagPrefix: 'tiffin-build-', asset: /^TiffinPOS-Setup-(.+)\.exe$/ },
  { id: 'tiffin-ods', product: 'tiffin_qsr', kind: 'addon', name: 'ODS (online orders)', description: 'Online orders from your website, app, Swiggy and Zomato on an order display screen. Install after Tiffin POS.', repo: 'souvik992/tiffin', tagPrefix: 'tiffin-build-', asset: /^TiffinPOS-ODS-Setup-(.+)\.exe$/ },
];

/** One download as the portal shows it. `url` is GitHub's; the portal links to /v1/account/downloads/<id>. */
export interface DownloadView {
  id: string; product: ProductCode; productName: string; app: string; kind: 'app' | 'addon'; name: string; description: string;
  available: boolean; version: string | null; fileName: string | null; size: number | null; publishedAt: string | null; build: string | null;
}
interface Found { version: string; fileName: string; size: number; publishedAt: string; build: string; url: string }
interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: Array<{ name: string; size: number; browser_download_url: string; state?: string }> }

export interface DownloadsOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a fetched list is used before GitHub is asked again (default 10 minutes). */
  cacheMs?: number;
  /** GITHUB_TOKEN: optional, raises GitHub's limit of 60 requests an hour per IP. */
  githubToken?: string;
  log?: { warn(m: string, d?: unknown): void };
}

const SETTING = 'downloads.catalogue';

export class Downloads {
  private db: Db;
  private o: DownloadsOptions;
  private found = new Map<string, Found>();
  private fetchedAt = 0;
  private refreshing: Promise<void> | null = null;

  constructor(db: Db, o: DownloadsOptions = {}) {
    this.db = db;
    this.o = o;
    exec(db, `CREATE TABLE IF NOT EXISTS download_log (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES account(id),
      user_id TEXT NOT NULL REFERENCES account_user(id), item TEXT NOT NULL, version TEXT NOT NULL, at INTEGER NOT NULL)`);
    exec(db, 'CREATE INDEX IF NOT EXISTS download_log_account ON download_log(account_id, at)');
    // the last list fetched, for when GitHub cannot be reached after a restart
    const saved = one<{ value_json: string }>(db, 'SELECT value_json FROM setting WHERE key = ?', SETTING);
    if (saved) {
      try { for (const [id, f] of Object.entries(JSON.parse(saved.value_json) as Record<string, Found>)) this.found.set(id, f); } catch { /* ignore a damaged copy */ }
    }
  }

  private now() { return (this.o.now ?? Date.now)(); }

  /** The catalogue (fetched from GitHub when the cached list is older than cacheMs; the cached list when GitHub fails). */
  async list(): Promise<DownloadView[]> {
    if (this.now() - this.fetchedAt > (this.o.cacheMs ?? 600_000)) await this.refresh();
    return CATALOGUE.map((item) => {
      const f = this.found.get(item.id);
      return {
        id: item.id, product: item.product, productName: PRODUCTS[item.product].name, app: PRODUCTS[item.product].app, kind: item.kind, name: item.name,
        description: item.description, available: !!f, version: f?.version ?? null, fileName: f?.fileName ?? null, size: f?.size ?? null,
        publishedAt: f?.publishedAt ?? null, build: f?.build ?? null,
      };
    });
  }

  /** Asks GitHub for each repository's releases (once at a time). Failures keep the list there was. */
  refresh(): Promise<void> {
    this.refreshing ??= this.refreshOnce().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    const repos = [...new Set(CATALOGUE.map((i) => i.repo))];
    const results = await Promise.all(repos.map(async (repo) => [repo, await this.releases(repo)] as const));
    let changed = false;
    for (const [repo, releases] of results) {
      if (!releases) continue; // GitHub failed for this repository: keep what we had
      for (const item of CATALOGUE.filter((i) => i.repo === repo)) {
        const f = pick(item, releases);
        if (f) { this.found.set(item.id, f); changed = true; } else if (this.found.delete(item.id)) changed = true;
      }
    }
    this.fetchedAt = this.now();
    if (changed) {
      exec(this.db, 'INSERT INTO setting (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
        SETTING, JSON.stringify(Object.fromEntries(this.found)), this.now());
    }
  }

  private async releases(repo: string): Promise<GhRelease[] | null> {
    try {
      const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'dinepos-cloud', 'x-github-api-version': '2022-11-28' };
      if (this.o.githubToken) headers.authorization = `Bearer ${this.o.githubToken}`;
      const res = await (this.o.fetch ?? fetch)(`https://api.github.com/repos/${repo}/releases?per_page=30`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      return (await res.json()) as GhRelease[];
    } catch (e) {
      this.o.log?.warn('downloads: could not read GitHub releases', { repo, error: String(e) });
      return null;
    }
  }

  /** A signed-in account's download: recorded, then the installer's address (the route redirects to it). */
  async start(userId: string, accountId: string, itemId: string): Promise<{ url: string; fileName: string }> {
    const item = CATALOGUE.find((i) => i.id === itemId);
    if (!item) throw new HubError('NOT_FOUND', 'No such download.', 404);
    if (!this.found.has(itemId)) await this.list();
    const f = this.found.get(itemId);
    if (!f) throw new HubError('NOT_AVAILABLE', `${item.name} is not available to download yet. Please try again later.`, 503);
    exec(this.db, 'INSERT INTO download_log (account_id, user_id, item, version, at) VALUES (?,?,?,?,?)', accountId, userId, item.id, f.version, this.now());
    return { url: f.url, fileName: f.fileName };
  }

  /** Downloads per item and version (the admin page). */
  stats(): Array<{ item: string; version: string; downloads: number; accounts: number; last: number }> {
    return many(this.db, `SELECT item, version, COUNT(*) AS downloads, COUNT(DISTINCT account_id) AS accounts, MAX(at) AS last
      FROM download_log GROUP BY item, version ORDER BY last DESC LIMIT 100`);
  }
}

/** The newest published release with this item's tag prefix that has its installer. */
function pick(item: DownloadItem, releases: GhRelease[]): Found | null {
  const ours = releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(item.tagPrefix) && r.published_at)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  for (const r of ours) {
    for (const a of r.assets) {
      const m = item.asset.exec(a.name);
      if (m && (a.state ?? 'uploaded') === 'uploaded') {
        return { version: m[1]!, fileName: a.name, size: a.size, publishedAt: r.published_at!, build: r.tag_name.slice(item.tagPrefix.length), url: a.browser_download_url };
      }
    }
  }
  return null;
}
