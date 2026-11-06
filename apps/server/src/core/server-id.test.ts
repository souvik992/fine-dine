import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { getConfig } from './outlet-config.js';
import { ensureServerId, readServerId } from './server-id.js';

describe('server id', () => {
  it('is made once and then kept', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(readServerId(db)).toBeNull();
    const id = ensureServerId(db, () => '01JCAAAAAAAAAAAAAAAAAAAAAA');
    expect(id).toBe('01JCAAAAAAAAAAAAAAAAAAAAAA');
    expect(ensureServerId(db, () => '01JCBBBBBBBBBBBBBBBBBBBBBB')).toBe(id);
    expect(readServerId(db)).toBe(id);
    // not an outlet setting
    expect(Object.keys(getConfig(db))).not.toContain('server.id');
    db.close();
  });
});
