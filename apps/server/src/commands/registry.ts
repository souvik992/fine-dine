// type → handler. One handler per file in this folder; add each new command here (see /add-command).
import { createRegistry, type CommandRegistry } from '../core/command-handler.js';

export const commandRegistry: CommandRegistry = createRegistry([]);
