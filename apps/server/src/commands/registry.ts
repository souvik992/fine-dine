// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandRegistry } from '../core/command-handler.js';
import { addItems } from './add-items.js';
import { addToWaitlist } from './add-to-waitlist.js';
import { assignCaptain } from './assign-captain.js';
import { adjustStock } from './adjust-stock.js';
import { cancelFiredItem } from './cancel-fired-item.js';
import { closeReservation } from './close-reservation.js';
import { createReservation } from './create-reservation.js';
import { dayEnd } from './day-end.js';
import { fireKot } from './fire-kot.js';
import { importMenu } from './import-menu.js';
import { installLicence } from './install-licence.js';
import { leaveWaitlist } from './leave-waitlist.js';
import { markKotReady } from './mark-kot-ready.js';
import { markKotServed } from './mark-kot-served.js';
import { mergeTables } from './merge-tables.js';
import { modifyFiredItem } from './modify-fired-item.js';
import { moveTable } from './move-table.js';
import { openDrawer } from './open-drawer.js';
import { openTable } from './open-table.js';
import { pairDevice } from './pair-device.js';
import { payIn } from './pay-in.js';
import { payOut } from './pay-out.js';
import { printBill } from './print-bill.js';
import { printSampleBill } from './print-sample-bill.js';
import { printTestPage } from './print-test-page.js';
import { recordPurchase } from './record-purchase.js';
import { recallKot } from './recall-kot.js';
import { reprintBill } from './reprint-bill.js';
import { requestBill } from './request-bill.js';
import { reprintKot } from './reprint-kot.js';
import { revokeDevice } from './revoke-device.js';
import { removeHeldItem } from './remove-held-item.js';
import { setCaptainSection } from './set-captain-section.js';
import { seatFromWaitlist } from './seat-from-waitlist.js';
import { seatReservation } from './seat-reservation.js';
import { setConfig } from './set-config.js';
import { setCovers } from './set-covers.js';
import { setItemAvailability } from './set-item-availability.js';
import { setRecipe } from './set-recipe.js';
import { setupOutlet } from './setup-outlet.js';
import { transferItems } from './transfer-items.js';
import { settle } from './settle.js';
import { splitBill } from './split-bill.js';
import { updateHeldItem } from './update-held-item.js';
import { updateReservation } from './update-reservation.js';
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
import { voidBill } from './void-bill.js';
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
  setCaptainSection,
  pairDevice,
  installLicence,
  revokeDevice,
  // orders
  openTable,
  addItems,
  updateHeldItem,
  removeHeldItem,
  setCovers,
  assignCaptain,
  requestBill,
  fireKot,
  // after the KOT (P2-04)
  modifyFiredItem,
  cancelFiredItem,
  reprintKot,
  reprintBill,
  // kitchen display (P4-02)
  markKotReady,
  markKotServed,
  recallKot,
  // tables (P2-03)
  moveTable,
  mergeTables,
  transferItems,
  // bookings and waitlist (P4-04)
  createReservation,
  updateReservation,
  closeReservation,
  seatReservation,
  addToWaitlist,
  seatFromWaitlist,
  leaveWaitlist,
  // billing + day
  printBill,
  splitBill,
  settle,
  voidBill,
  // cash drawer (P2-06)
  payIn,
  payOut,
  openDrawer,
  dayEnd,
];

export const commandRegistry: CommandRegistry = createRegistry(handlers);
