import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
const migrationsDir = fileURLToPath(new URL("../../../packages/saas-db/migrations/", import.meta.url));

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [72419031]);
    await client.query(`CREATE TABLE IF NOT EXISTS saas_schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDir)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
    for (const filename of files) {
      const existing = await client.query("SELECT 1 FROM saas_schema_migrations WHERE filename = $1", [filename]);
      if (existing.rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO saas_schema_migrations(filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.info(`Applied SaaS migration ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [72419031]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("SaaS migration failed", error);
  process.exitCode = 1;
});
