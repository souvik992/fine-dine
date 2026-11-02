// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandRegistry } from '../core/command-handler.js';
import { addItems } from './add-items.js';
import { adjustStock } from './adjust-stock.js';
import { cancelFiredItem } from './cancel-fired-item.js';
import { dayEnd } from './day-end.js';
import { fireKot } from './fire-kot.js';
import { importMenu } from './import-menu.js';
import { mergeTables } from './merge-tables.js';
import { modifyFiredItem } from './modify-fired-item.js';
import { moveTable } from './move-table.js';
import { openTable } from './open-table.js';
import { printBill } from './print-bill.js';
import { printSampleBill } from './print-sample-bill.js';
import { printTestPage } from './print-test-page.js';
import { recordPurchase } from './record-purchase.js';
import { reprintBill } from './reprint-bill.js';
import { reprintKot } from './reprint-kot.js';
import { removeHeldItem } from './remove-held-item.js';
import { setConfig } from './set-config.js';
import { setItemAvailability } from './set-item-availability.js';
import { setRecipe } from './set-recipe.js';
import { setupOutlet } from './setup-outlet.js';
import { transferItems } from './transfer-items.js';
import { settle } from './settle.js';
import { updateHeldItem } from './update-held-item.js';
import { upsertAddonGroup } from './upsert-addon-group.js';
import { upsertArea } from './upsert-area.js';
import { upsertCategory } from './upsert-category.js';
import { upsertMenuItem } from './upsert-menu-item.js';
import { upsertRole } from './upsert-role.js';
import { upsertUser } from './upsert-user.js';
import { upsertPrinter } from './upsert-printer.js';
import { upsertStation } from './upsert-station.js';
import { upsertStockItem } from './upsert-stock-item.js';
import { upsertTable } from './upsert-table.js';
import { voidPurchase } from './void-purchase.js';

const handlers = [
  // admin
  upsertArea,
  upsertTable,
  upsertPrinter,
  upsertStation,
  upsertCategory,
  upsertAddonGroup,
  upsertMenuItem,
  importMenu,
  setConfig,
  printTestPage,
  printSampleBill,
  // menu availability + stock
  setItemAvailability,
  upsertStockItem,
  adjustStock,
  recordPurchase,
  voidPurchase,
  setRecipe,
  // staff
  setupOutlet,
  upsertUser,
  upsertRole,
  // orders
  openTable,
  addItems,
  updateHeldItem,
  removeHeldItem,
  fireKot,
  // after the KOT (P2-04)
  modifyFiredItem,
  cancelFiredItem,
  reprintKot,
  reprintBill,
  // tables (P2-03)
  moveTable,
  mergeTables,
  transferItems,
  // billing + day
  printBill,
  settle,
  dayEnd,
];

export const commandRegistry: CommandRegistry = createRegistry(handlers);
