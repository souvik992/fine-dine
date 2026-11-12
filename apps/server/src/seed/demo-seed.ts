// P7-04: the DinePOS Cloud browser demo's sample outlet: the development seed (areas, tables, menu, fake printers,
// staff with well-known PINs) as plain data. `npm run bundle:cloud` writes it to outlet-server/demo-seed.json in posinext-cloud;
// the cloud sends it to a new demo outlet as ordinary commands, so the outlet server stays the only writer.
// The PINs are shown to the visitor on purpose: a demo outlet holds no real data and is deleted after 72 hours.
import { DEV_OWNER, DEV_STAFF, devSeedCommands, devSetupCommand, seedId, type SeedCommand } from './dev-seed.js';

export interface DemoSeed {
  setup: SeedCommand;
  commands: SeedCommand[];
  owner: { id: string; name: string; pin: string };
  staff: Array<{ id: string; name: string; pin: string }>;
}

export function demoSeed(): DemoSeed {
  const setup = devSetupCommand();
  return {
    setup: { type: setup.type, payload: { ...setup.payload, outletName: 'Spice Garden (demo)' } },
    commands: devSeedCommands(),
    owner: { ...DEV_OWNER },
    staff: DEV_STAFF.map((s) => ({ id: seedId(`user:${s.key}`), name: s.name, pin: s.pin })),
  };
}
