// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandHandler, type CommandRegistry } from '../core/command-handler.js';
import { acceptOnlineOrder } from './accept-online-order.js';
import { advanceOnlineOrder } from './advance-online-order.js';
import { applyHubEvent } from './apply-hub-event.js';
import { cancelOnlineOrder } from './cancel-online-order.js';
import { noteOnlineOrder } from './note-online-order.js';
import { recordHubAction } from './record-hub-action.js';
import { recordOnlinePublish } from './record-online-publish.js';
import { rejectOnlineOrder } from './reject-online-order.js';
import { saveOnlineLink } from './save-online-link.js';
import { unlinkOnlineHub } from './unlink-online-hub.js';
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
import { importRecipes } from './import-recipes.js';
import { removeItemImage } from './remove-item-image.js';
import { setItemImage } from './set-item-image.js';
import { releaseTable } from './release-table.js';
import { recordSyncAck } from './record-sync-ack.js';
import { renewLicence } from './renew-licence.js';
import { resetSyncStream } from './reset-sync-stream.js';
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

export const coreHandlers: readonly CommandHandler<unknown, unknown>[] = [
  // admin
  upsertArea,
  upsertTable,
  upsertPrinter,
  upsertStation,
  upsertCategory,
  upsertAddonGroup,
  upsertMenuItem,
  importMenu,
  setItemImage,
  removeItemImage,
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
  importRecipes,
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
  releaseTable,
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
  // online orders through the hub (P4-06)
  acceptOnlineOrder,
  rejectOnlineOrder,
  advanceOnlineOrder,
  cancelOnlineOrder,
  unlinkOnlineHub,
  // internal: the hub connector
  saveOnlineLink,
  applyHubEvent,
  recordHubAction,
  recordOnlinePublish,
  noteOnlineOrder,
  // cloud sync (P4-05): reset by the admin; the rest internal to the sync agent
  resetSyncStream,
  recordSyncAck,
  renewLicence,
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

export const commandRegistry: CommandRegistry = createRegistry(coreHandlers);
