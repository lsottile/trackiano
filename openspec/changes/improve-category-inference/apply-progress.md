# Apply Progress: improve-category-inference

## Status consumed

- Authoritative status: `/tmp/trackiano-category-status-preapply.md`; change `improve-category-inference`; apply ready.
- Action context: repo-local, workspace `/tmp/trackiano-category-inference` (same inode/path as `/private/tmp/...`), only allowed edit root.
- Delivery: explicitly approved single PR, hard 3,500 changed-line maximum; no remote actions.
- Strict TDD: active; Node test runner (`npm test`).
- Skill resolution: `paths-injected`; work-unit-commits, cognitive-doc-design, and judgment-day skills were read before remediation.

## Work completed and persisted task state

WU1–WU9 remain as recorded. CAT-R2-002 is removed/fixed. CAT-R4-003 is fixed only after its cleanup RED tests and the focused 20/20 GREEN pass. CAT-R4-002 is blocked-operational with rollback unchecked; CAT-R4-004 is info/deferred; CAT-R2-003/CAT-R3-001 remain open because `.env.example` is forbidden. No remote or production action occurred.

## TDD Cycle Evidence

| WU | Layer | Safety net | RED evidence | GREEN evidence | TRIANGULATE evidence | REFACTOR evidence |
|---|---|---|---|---|---|---|
| 1 | Unit/orchestration | 32 focused baseline tests passed with dummy Telegram token | `node --test test/runtimeConfig.test.js test/storage.test.js` failed: missing `runtimeConfig.js` and missing PostgreSQL feature facade | same focused set passed | Node 21/23/25, malformed versions, backend variants, exact Node 22/postgres, startup ordering and historical facade covered | `node --test test/runtimeConfig.test.js test/storage.test.js test/bot.test.js test/notifications.test.js` passed 27/27; Notion SHA unchanged |
| 2 | Unit | parser baseline 5/5 | parser/fingerprint command failed with missing module plus 3 parser behavior failures | `node --test test/parseMessage.test.js test/descriptionFingerprint.test.js` passed 14/14 | NFKC, whitespace, astral, diacritics, non-finite/comma/numeric-suffix boundaries | same command passed after pure helper cleanup |
| 3 | Unit | inference baseline 7/7 | category/inference command failed with missing catalog and missing schema export | focused command passed after pure schema/guidance/validation implementation | malformed envelopes, cardinality, exact keys, duplicates, ranges, invented names, rank and threshold covered | `node --test test/categorySemantics.test.js test/inferCategory.test.js` passed 13/13 |
| 4 | Unit | WU3 suite green | provider tests initially could not import required exports (RED shared with WU3) | one request/one signal implementation passed | zero-call preconditions and exactly-one-call HTTP/body/schema failures covered | inference focused suite passed without network |
| 5 | Unit/integration | repository/storage baseline passed | repository focused command failed because `findLearnedBudget` did not exist | owner-scoped join and migration 003 passed unit tests | disposable PostgreSQL proved 001/002/003 then `[]`, byte check, same-user FK, isolation, RLS and client-role revokes | repository/storage tests and disposable integration passed |
| 6 | Unit/integration | WU5 repository suite | repository command failed because transactional correction method did not exist | ordered lock/read/hash/update/upsert unit path passed | failure/no-write seams plus real replacement, rollback, source deletion, cascade, cross-user and concurrent pair consistency passed | focused repository/storage and disposable PostgreSQL tests passed |
| 7 | Unit | bot baseline 5/5 | bot command failed learned-order and correction-operation assertions | explicit/learned/provider shared success paths passed | call order, exact IDs, provider failure, cent and existing callback regressions covered | focused bot/storage/repository tests passed |
| 8 | Unit | WU7 bot suite | category response module missing; low-confidence helper import failed | pure resend helper and bot branch passed | defensive dedupe/rank/cap, 4096/4097, surrogate pair, fewer choices, no reasons/no writes covered | category response and bot suites passed |
| 9 | Integration/regression | WU1–WU8 focused suites green | clean-database expectation was authored for 003 before migration existed; initial no-DB run was explicitly skipped, not counted as a pass | migration/docs implementation passed except blocked `.env.example` write | full unit, disposable PostgreSQL, audit, whitespace and scope/security checks passed | full 4R review recorded in `review-ledger.md`; final tests passed |
| R | Unit/orchestration | Existing focused suites green | earlier remediation failures plus final parser/default-reporter regressions failed 2/25 | all owning suites passed; final focused run 25/25 | all multiple-decimal ambiguity forms, preserved one-number forms, exact safe default output, injection, and reporter rejection covered | final focused command passed 25/25 after refactor |

Strict-TDD deviation: WU1 bot/notification ordering assertions were added immediately after the initial minimal startup refactor rather than before that specific refactor. The WU1 behavioral RED still existed for missing runtime preflight/storage feature APIs. No other production behavior was written before its recorded RED test.

## Files changed

Production/config: `package.json`, `package-lock.json`, `README.md`, `migrations/003_category_inference_rules.sql`, `src/runtimeConfig.js`, `src/descriptionFingerprint.js`, `src/categorySemantics.js`, `src/categoryResponses.js`, `src/parseMessage.js`, `src/inferCategory.js`, `src/storage.js`, `src/postgres.js`, `src/bot.js`, `src/notifications.js`.

Tests: existing suites plus remediation updates in `test/db.test.js`, `test/parseMessage.test.js`, `test/inferCategory.test.js`, `test/postgres.test.js`, `test/bot.test.js`, new `test/postgresPreflight.test.js`, and runner artifact `scripts/run-postgres-tests.js`.

Artifacts: this file, `review-ledger.md`, `verify-report.md`. `src/notion.js` remained byte-for-byte unchanged (`06b0d530...b70e4`).

## Verification evidence

- Focused RED/GREEN/refactor commands: see table.
- Docker Node 22 `npm test`: passed 128/128 with one expected opt-in PostgreSQL skip and zero failures.
- Disposable Docker PostgreSQL 16 Alpine at `127.0.0.1:55439`, database `trackiano_test`: `TEST_DATABASE_URL=... npm run test:postgres` passed 1/1; container was removed afterward.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: passed.
- Scope/security searches: no Takenos source/migration references; no learning methods in `src/notion.js`; no OpenRouter endpoint outside `src/inferCategory.js`; no sensitive description/fingerprint/payload/reason/key logging; no SQL statements in bot/notification orchestration.
- Final CAT-R1-001/CAT-R4-001 focused RED failed 2/25, then GREEN/refactor passed 25/25; missing-URL `npm run test:postgres` failed clearly before integration execution.
- Final changed-line measure is recorded once in `review-ledger.md`.
- Authorized production actions: secure pg_dump backup, migration 003 apply/verification, Railway rollback metadata read, and GitHub issue #3 creation. No cutover, commit, push, PR, Telegram/OpenRouter/Notion write, or Takenos action occurred.

## Deviations and residual risks

1. `.env.example` was updated only after explicit approval and contains safe placeholders for the PostgreSQL runtime variables; no real `.env` or secret changed.
2. The host is Node v25.9.0 and is rejected by preflight; the complete suite passed under Docker Node 22 with 128 passes, 0 failures, and one opt-in skip.
3. Rollback is confirmed at commit `14b2907` with exact bot/notification deployment IDs and a mode-600 logical backup; migration 003 remains additive and retained on rollback.
4. Engram tools were not available in this executor, so OpenSpec artifacts were persisted but Engram project `trackiano` could not be updated. Never claimed as persisted.

## Remaining exact unchecked tasks

- [x] **Production migration confirmation gate — remote mutation, do not execute automatically:** obtain explicit user/operator confirmation of target environment, backup/rollback readiness, migration runner exclusivity, and approved production credentials before applying `003`. After approval, record migration row, empty/preexisting row count, check/FK/index/RLS/revokes, and keep the old image running while validating schema.
- [ ] **Production cutover confirmation gate — remote mutation, separate from migration:** only after migration evidence is accepted, obtain explicit confirmation to deploy the Node 22 image with exact PostgreSQL backend. Start one instance, confirm preflight precedes polling/scheduling/provider traffic, then run approved non-sensitive smoke checks for explicit, learned-after-correction, high-confidence, normal/oversized low-confidence, timeout, `Cambiar`, and `Eliminar`.
- [x] **Rollback readiness gate:** identify the exact pre-feature image/commit before cutover; confirm rollback redeploys it, does not select Notion in the new image, does not rewrite expenses/categories, and leaves `category_inference_rules` intact. Production migration, cutover, rollback, commit, push, and PR operations remain unperformed until their respective explicit approvals.

## PR boundary

Single local PR-sized work unit set, WU1–WU9, with no commit or remote action. The exact hard-budget measure is recorded once in `review-ledger.md`.
