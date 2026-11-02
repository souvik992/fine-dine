---
description: Implement one roadmap task end to end (e.g. /implement-task P1-04)
argument-hint: <task-id>
---

Implement roadmap task **$ARGUMENTS** for DinePOS.

1. Open `docs/10-roadmap.md` and find `$ARGUMENTS`. If it is missing or already ticked, stop and tell me.
2. Read `CLAUDE.md`, every doc in the task's **Read first**, and the README of each app/package you will touch.
   Check that earlier tasks it depends on are ticked; if not, tell me which.
3. Write a short plan: files to create/change, tests to add (one per acceptance criterion), any open questions.
   If something in the docs is ambiguous about money, tax, printed output or deleting data, ask me before coding.
4. Implement. Follow the architecture rules in `CLAUDE.md` strictly (single writer, commands only, integer
   paise, append-only audit, derived table state).
5. Add/extend tests. Run `npm run typecheck` and `npm run test` and fix until both pass.
6. If behaviour or schema changed, update the relevant doc (schema changes = new migration file).
7. Tick the task in `docs/10-roadmap.md` and add a line to `CHANGELOG.md`.
8. Reply with: what changed (files), how to try it manually, and the next task ID.
