---
description: Add a new POS command (schema, handler, tests, docs)
argument-hint: <CommandName>
---

Add the POS command **$ARGUMENTS**.

1. Check `docs/03-command-api.md`. If `$ARGUMENTS` is listed, use its payload, right, PIN rule, effects and
   leakage flag. If not listed, propose a row for the table and wait for my OK.
2. Create the zod payload schema in `packages/shared/src/schemas/commands/<kebab-name>.ts` and export it.
3. Create the handler in `apps/server/src/commands/<kebab-name>.ts` following the handler contract in
   `apps/server/README.md`; register it in `registry.ts`.
4. Emit the right WS events (`docs/04-realtime-events.md`), audit entries (with leakage flag where listed) and
   print jobs (`docs/06-printing-kds.md`).
5. Tests in `<kebab-name>.test.ts`: happy path, VERSION_CONFLICT, FORBIDDEN, PIN_REQUIRED (if applicable),
   DUPLICATE replay, INVALID_STATE, and every invariant from `docs/02-domain-model.md` it touches.
6. Run typecheck + tests. Update docs if anything differs. Summarise.
