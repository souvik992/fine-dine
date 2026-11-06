// Which licence check this server runs (P2-09).
import { IS_BUNDLED } from '../version.js';
import { createLicenceGate, unenforcedGate, type LicenceGate } from './gate.js';
import { hardwareId, hostedHardwareId } from './hardware.js';
import { LICENCE_PUBLIC_KEY } from './public-key.js';

/**
 * The installed server (the bundle in the installer) always checks against the vendor's public key; environment
 * variables cannot change that. A run from source (development, tests) does not enforce a licence unless
 * DINEPOS_LICENCE_PUBLIC_KEY is set (a test key pair), optionally with DINEPOS_HARDWARE_ID.
 */
export function licenceGateFor(env: NodeJS.ProcessEnv = process.env, bundled = IS_BUNDLED): LicenceGate {
  // P6-04: a hosted outlet (run by DinePOS Cloud, which sets both) is licensed per outlet, not per cloud machine
  const hosted = env.DINEPOS_HOST_KEY && env.DINEPOS_HOSTED_OUTLET ? hostedHardwareId(env.DINEPOS_HOSTED_OUTLET) : null;
  if (bundled) return createLicenceGate({ publicKey: LICENCE_PUBLIC_KEY, hardwareId: hosted ?? hardwareId() });
  const testKey = env.DINEPOS_LICENCE_PUBLIC_KEY;
  if (testKey) return createLicenceGate({ publicKey: testKey, hardwareId: env.DINEPOS_HARDWARE_ID || hardwareId() });
  return unenforcedGate(env.DINEPOS_HARDWARE_ID || 'DEV');
}
