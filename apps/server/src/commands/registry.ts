// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandRegistry } from '../core/command-handler.js';
import { addItems } from './add-items.js';
import { dayEnd } from './day-end.js';
import { fireKot } from './fire-kot.js';
import { openTable } from './open-table.js';
import { printBill } from './print-bill.js';
import { removeHeldItem } from './remove-held-item.js';
import { setConfig } from './set-config.js';
import { settle } from './settle.js';
import { updateHeldItem } from './update-held-item.js';
import { upsertAddonGroup } from './upsert-addon-group.js';
import { upsertArea } from './upsert-area.js';
import { upsertCategory } from './upsert-category.js';
import { upsertMenuItem } from './upsert-menu-item.js';
import { upsertPrinter } from './upsert-printer.js';
import { upsertStation } from './upsert-station.js';
import { upsertTable } from './upsert-table.js';

const handlers = [
  // admin
  upsertArea,
  upsertTable,
  upsertPrinter,
  upsertStation,
  upsertCategory,
  upsertAddonGroup,
  upsertMenuItem,
  setConfig,
  // orders
  openTable,
  addItems,
  updateHeldItem,
  removeHeldItem,
  fireKot,
  // billing + day
  printBill,
  settle,
  dayEnd,
];

export const commandRegistry: CommandRegistry = createRegistry(handlers);
