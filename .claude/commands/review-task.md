---
description: Review a finished roadmap task against its acceptance criteria
argument-hint: <task-id>
---

Review task **$ARGUMENTS** as a strict senior reviewer. Do not change code unless I ask.

1. Read the task in `docs/10-roadmap.md`, its **Read first** docs and `CLAUDE.md`.
2. Read the code and tests that implement it (use git diff/log if helpful).
3. For each acceptance criterion: PASS / FAIL / NOT TESTED, with the test name or the gap.
4. Check the architecture rules: single writer, commands only, one transaction, post-commit publish,
   integer paise, append-only audit, derived table state, snapshots, gap-free bill numbers.
5. List bugs and risks ordered by severity, each with file:line and a suggested fix.
6. Run `npm run typecheck` and `npm run test` and report results.
