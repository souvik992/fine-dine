import path from 'node:path';
import { isValidTimeZone } from '@dinepos/shared';
import { z } from 'zod';
import { StartupError } from './core/errors.js';

export interface ServerConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  timeZone: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DINEPOS_HOST: z.string().trim().min(1).default('0.0.0.0'),
  DINEPOS_PORT: z.coerce.number().int().min(0).max(65_535).default(7420),
  DATA_DIR: z.string().trim().min(1).optional(),
  DINEPOS_TIMEZONE: z
    .string()
    .trim()
    .default('Asia/Kolkata')
    .refine(isValidTimeZone, { message: 'must be an IANA time zone such as Asia/Kolkata' }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Where the master keeps its data when DATA_DIR is not set (docs/01-architecture.md). */
function defaultDataDir(
  mode: ServerConfig['env'],
  env: NodeJS.ProcessEnv,
  cwd: string,
  platform: NodeJS.Platform,
): string {
  if (mode !== 'production') return path.resolve(cwd, 'data');
  if (platform === 'win32') return path.win32.join(env.ProgramData ?? 'C:\\ProgramData', 'DinePOS');
  return '/var/lib/dinepos';
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new StartupError('CONFIG', `Invalid server configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.DINEPOS_HOST,
    port: e.DINEPOS_PORT,
    dataDir: e.DATA_DIR ? path.resolve(cwd, e.DATA_DIR) : defaultDataDir(e.NODE_ENV, env, cwd, platform),
    dbFile: e.NODE_ENV === 'production' ? 'dinepos.db' : 'dev.db',
    timeZone: e.DINEPOS_TIMEZONE,
    logLevel: e.LOG_LEVEL,
  };
}
