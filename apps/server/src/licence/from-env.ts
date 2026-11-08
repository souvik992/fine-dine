// Which licence check this server runs (P2-09).
import { IS_BUNDLED } from '../version.js';
import { createLicenceGate, unenforcedGate, type LicenceGate } from './gate.js';
import { hardwareId, hostedHardwareId } from './hardware.js';
import { CLOUD_KEY_MAX_DAYS, TRUSTED_LICENCE_KEYS } from './public-key.js';

/**
 * The installed server (the bundle in the installer) always checks against the vendor's public key; environment
 * variables cannot change that. A run from source (development, tests) does not enforce a licence unless
 * DINEPOS_LICENCE_PUBLIC_KEY is set (a test key pair), optionally with DINEPOS_HARDWARE_ID. P7-02:
 * DINEPOS_CLOUD_LICENCE_PUBLIC_KEY adds a test cloud key (with the cloud's day limit).
 */
export function licenceGateFor(env: NodeJS.ProcessEnv = process.env, bundled = IS_BUNDLED): LicenceGate {
  // P6-04: a hosted outlet (run by DinePOS Cloud, which sets both) is licensed per outlet, not per cloud machine
  const hosted = env.DINEPOS_HOST_KEY && env.DINEPOS_HOSTED_OUTLET ? hostedHardwareId(env.DINEPOS_HOSTED_OUTLET) : null;
  if (bundled) return createLicenceGate({ keys: TRUSTED_LICENCE_KEYS, hardwareId: hosted ?? hardwareId() });
  const testKey = env.DINEPOS_LICENCE_PUBLIC_KEY;
  const testCloud = env.DINEPOS_CLOUD_LICENCE_PUBLIC_KEY;
  if (testKey || testCloud) {
    const keys = [...(testKey ? [{ id: 'master', publicKey: testKey }] : []), ...(testCloud ? [{ id: 'cloud', publicKey: testCloud, maxDays: CLOUD_KEY_MAX_DAYS }] : [])];
    return createLicenceGate({ keys, hardwareId: env.DINEPOS_HARDWARE_ID || hosted || hardwareId() });
  }
  return unenforcedGate(env.DINEPOS_HARDWARE_ID || 'DEV');
}
