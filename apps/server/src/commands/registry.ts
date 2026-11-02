// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandRegistry } from '../core/command-handler.js';
import { upsertAddonGroup } from './upsert-addon-group.js';
import { upsertArea } from './upsert-area.js';
import { upsertCategory } from './upsert-category.js';
import { upsertMenuItem } from './upsert-menu-item.js';
import { upsertPrinter } from './upsert-printer.js';
import { upsertStation } from './upsert-station.js';
import { upsertTable } from './upsert-table.js';

const handlers = [upsertArea, upsertTable, upsertPrinter, upsertStation, upsertCategory, upsertAddonGroup, upsertMenuItem];

export const commandRegistry: CommandRegistry = createRegistry(handlers);
