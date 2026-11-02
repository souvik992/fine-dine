import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses development defaults', () => {
    const c = loadConfig({}, '/work/apps/server', 'linux');
    expect(c).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 7420,
      dataDir: path.resolve('/work/apps/server', 'data'),
      dbFile: 'dev.db',
      timeZone: 'Asia/Kolkata',
      logLevel: 'info',
      allowedOrigins: ['app://dinepos', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    });
  });

  it('keeps production data in ProgramData on Windows', () => {
    const c = loadConfig({ NODE_ENV: 'production', ProgramData: 'D:\\PD' }, 'C:\\app', 'win32');
    expect(c.dataDir).toBe('D:\\PD\\DinePOS');
    expect(c.dbFile).toBe('dinepos.db');
  });

  it('honours DATA_DIR and port overrides', () => {
    const c = loadConfig({ DATA_DIR: './x', DINEPOS_PORT: '8000' }, '/work', 'linux');
    expect(c.dataDir).toBe(path.resolve('/work', 'x'));
    expect(c.port).toBe(8000);
  });

  it('reads allowed origins as a list', () => {
    expect(loadConfig({ DINEPOS_ALLOWED_ORIGINS: 'app://dinepos, http://10.0.0.5:5173 ,' }).allowedOrigins).toEqual(['app://dinepos', 'http://10.0.0.5:5173']);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ DINEPOS_PORT: '99999' })).toThrow(/DINEPOS_PORT/);
    expect(() => loadConfig({ DINEPOS_TIMEZONE: 'Mars/Base' })).toThrow(/IANA time zone/);
  });
});
