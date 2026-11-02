import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';

/** `:memory:` database with every migration applied (CLAUDE.md test convention). */
export function createTestDb(): Db {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}
