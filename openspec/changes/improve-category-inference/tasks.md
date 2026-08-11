# Tasks: Improve Category Inference Safely

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,870–2,470 total; see work units below |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Justified single-PR size exception: WU 1 → WU 2 → WU 3 → WU 4 → WU 5 → WU 6 → WU 7 → WU 8 → WU 9 |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

One PR will exceed 400 changed lines, but the session explicitly selected a single-PR default and a hard 3,500-line budget. The exception is justified because parser/provider trust boundaries, migration/repository security, and bot compatibility need one atomic release review. Keep each unit as a reviewable commit with its tests and rollback boundary. Reforecast after every unit; if the upper forecast or actual diff exceeds 3,500 lines, stop before further apply work and request a chained-delivery decision rather than exceeding the budget.

## Strict-TDD and Evidence Contract

For every work unit, record RED, GREEN, TRIANGULATE, and REFACTOR evidence in `openspec/changes/improve-category-inference/apply-progress.md` and the review result in `openspec/changes/improve-category-inference/review-ledger.md`.

- **RED:** add the focused test first; record the exact command and expected behavior-specific failure.
- **GREEN:** make only the smallest production change needed; rerun the same focused test.
- **TRIANGULATE:** add boundary, failure, ownership, or regression cases and run the unit's broader test set.
- **REFACTOR:** improve structure without behavior changes, rerun focused tests, and record changed lines (`additions + deletions`).
- Keep tests, behavior, relevant docs, and rollback notes in the same work unit. Never contact OpenRouter, Notion, Railway, Supabase, or another paid/remote service during local verification.

## Work Unit Forecast

| Work unit | Behavior and evidence kept together | Forecast |
|---|---|---:|
| WU 1 | Runtime/backend preflight and strict PostgreSQL storage wiring | 160–210 |
| WU 2 | Parser compatibility and description fingerprinting | 180–240 |
| WU 3 | Semantic catalog and ranked inference trust boundary | 300–390 |
| WU 4 | One-request timeout-bounded provider execution | 110–160 |
| WU 5 | Migration 003 security and learned-rule lookup | 260–340 |
| WU 6 | Transactional recategorization and latest-rule replacement | 250–330 |
| WU 7 | Bot learned selection, correction wiring, and success compatibility | 250–330 |
| WU 8 | Low-confidence resend UX and safe provider failures | 170–240 |
| WU 9 | PostgreSQL integration, operations docs, gates, and final review | 190–230 |
| **Total** | **One PR; tests and docs included** | **1,870–2,470** |

## WU 1 — Fail fast on runtime/backend and wire strict storage

**Start:** application entrypoints can construct storage before validating runtime/backend, and storage defaults to Notion.
**Finish:** new application entrypoints accept only Node 22.x plus exact `STORAGE_BACKEND=postgres`; the historical Notion adapter remains unchanged.
**Rollback:** revert this unit to restore prior startup/storage selection; no data changes.

- [x] **RED:** Add `test/runtimeConfig.test.js` and focused `test/storage.test.js`, `test/bot.test.js`, and `test/notifications.test.js` cases proving Node 21/23, unset backend, `notion`, case variants, and unknown values fail before storage construction, handlers/schedulers, polling, or provider calls; prove Node 22 + exact `postgres` passes.
- [x] **GREEN:** Add `src/runtimeConfig.js`; call preflight at the earliest executable boundary in `src/bot.js` and `src/notifications.js`; declare `engines.node` as `>=22 <23` in `package.json`; remove the application singleton's Notion default in `src/storage.js` and construct it only from `createDefaultPostgresRepository()` after preflight.
- [x] **TRIANGULATE:** Test injected version/backend values, malformed versions, preflight ordering, and that the generic historical factory can still support migration/rollback tests without exposing a new-image Notion mode.
- [x] **REFACTOR:** Separate base repository methods from PostgreSQL feature methods, keep `src/notion.js` byte-for-byte unchanged, and run `node --test test/runtimeConfig.test.js test/storage.test.js test/bot.test.js test/notifications.test.js`.

## WU 2 — Parse multi-word categories and fingerprint exact descriptions

**Start:** only one trailing category token is parsed and no deterministic learning key exists.
**Finish:** rightmost finite amount parsing is backward compatible, and normalized descriptions produce stable private SHA-256 fingerprints.
**Rollback:** revert pure parser/fingerprint files; no persisted records exist yet.

- [x] **RED:** Extend `test/parseMessage.test.js` for prior successful forms, Spanish/English multi-word categories, earlier numeric description tokens, omitted categories, finite-only amounts, missing fields, comma decimals, and numeric suffix ambiguity. Add `test/descriptionFingerprint.test.js` for type/empty rejection, NFKC, ECMAScript whitespace, lowercase, preserved diacritics, equivalence/non-equivalence tables, and published SHA-256 vectors.
- [x] **GREEN:** Update `src/parseMessage.js` to scan right-to-left for the first finite numeric token and preserve the current error family; add `src/descriptionFingerprint.js` with the exact normalize-then-SHA-256 contract.
- [x] **TRIANGULATE:** Add compatibility characters, tabs/newlines, astral text, `Infinity`/`NaN`, and descriptions containing earlier numbers; prove unsupported comma decimals and numeric category suffixes are not advertised as supported.
- [x] **REFACTOR:** Keep normalization and hashing pure and independently exported; run `node --test test/parseMessage.test.js test/descriptionFingerprint.test.js`.

## WU 3 — Build bilingual guidance and validate ranked candidates locally

**Start:** the provider receives broad prose and returns one weakly validated category.
**Finish:** exact aliases receive static bilingual guidance, arbitrary categories remain name-only, and ranked output is strictly allowlisted and normalized to stored identities.
**Rollback:** revert `src/categorySemantics.js` and ranked pure helpers; no writes or network behavior change is required to roll back.

- [x] **RED:** Add `test/categorySemantics.test.js` for every specified alias family, Housing/Lodging and Investments/Shopping bilingual boundaries, exact stored spelling, unknown name-only fallback, and no absent category. Extend `test/inferCategory.test.js` for the literal strict JSON schema, bilingual/mixed prompt context, envelope parsing, exact own-key/cardinality rules, confidence/reason bounds, invented names, duplicates, rank preservation, exact stored spelling/ID substitution, and `0.7` threshold boundaries.
- [x] **GREEN:** Add frozen/versioned `src/categorySemantics.js`; refactor `src/inferCategory.js` to export `CANDIDATE_SCHEMA`, `MIN_CONFIDENCE`, `buildInferenceRequest`, `extractCandidatePayload`, `validateRankedCandidates`, `findBudgetByName`, and `selectTopCandidate` as designed.
- [x] **TRIANGULATE:** Cover arrays/null/prototypes/extra keys, fenced or trailing JSON, empty/oversized candidate lists, zero retained candidates, NaN/infinities/ranges, duplicate case variants, arbitrary categories, and a low-ranked high-confidence candidate behind a valid low-confidence first candidate.
- [x] **REFACTOR:** Keep prompt construction, provider-envelope parsing, and local trust validation separate; ensure reasons are never displayed, persisted, or logged; run `node --test test/categorySemantics.test.js test/inferCategory.test.js`.

## WU 4 — Enforce one bounded OpenRouter request

**Start:** inference uses global fetch without a timeout and has no deterministic request-count seam.
**Finish:** each non-local attempt uses one request, one Node 22 timeout signal, no retry, and safe validation.
**Rollback:** revert provider execution while leaving pure ranked helpers harmlessly unused.

- [x] **RED:** Extend `test/inferCategory.test.js` with injected `fetchImpl` and `createTimeoutSignal` cases for missing key, empty budgets, invalid/over-default timeout, one signal passed to one fetch, body consumption under that signal, HTTP/abort/JSON/schema failure, and zero retries.
- [x] **GREEN:** Implement `OPENROUTER_TIMEOUT_MS`, injectable provider dependencies, positive bounded timeout validation, exact OpenRouter `json_schema` wrapper, and one fetch/one signal in `src/inferCategory.js`.
- [x] **TRIANGULATE:** Prove failures before request issue zero calls and every post-request failure remains exactly one call; inspect requests to ensure they contain only current description/amount, current category allowlist, static guidance, model, and no credentials in the body or learning history.
- [x] **REFACTOR:** Centralize provider errors without retaining payloads or sensitive values; run `node --test test/inferCategory.test.js` without real network access.

## WU 5 — Add secure migration 003 and owner-scoped learned lookup

**Start:** no learned-rule table or repository lookup exists.
**Finish:** additive migration 003 enforces isolation/security, and valid owner-scoped joined lookups return only current same-user categories.
**Rollback:** application can be reverted while the additive empty/unused table remains; never reverse-migrate during emergency rollback.

- [x] **RED:** Add migration assertions to `test/postgres.integration.test.js` and repository cases to `test/postgres.test.js` for exact 64-lowercase-hex validation, explicit owner predicates, joined same-user budget lookup, misses/stale categories, and cross-user isolation.
- [x] **GREEN:** Add `migrations/003_category_inference_rules.sql` with 32-byte check, `(user_id, description_fingerprint)` primary key, same-user composite budget FK, supporting index, cascades, RLS, and conditional `anon`/`authenticated` revokes; add `findLearnedBudget` to `src/postgres.js` and the strict PostgreSQL facade in `src/storage.js`.
- [x] **TRIANGULATE:** On an approved disposable local PostgreSQL database, prove clean order `001`, `002`, `003`, second run `[]`, no backfill/financial mutation, same fingerprint isolation by user, cross-user FK rejection, physical budget cascade, source-expense independence, RLS flag, and denied client-role privileges. If `TEST_DATABASE_URL` is absent, record the integration test as blocked—not passed.
- [x] **REFACTOR:** Keep SQL out of bot code, keep explicit owner predicates despite service-role RLS bypass, and run `node --test test/postgres.test.js test/storage.test.js`; run `npm run test:postgres` only against the explicitly approved disposable database.

## WU 6 — Recategorize and learn in one transaction

**Start:** manual correction updates only an expense category.
**Finish:** the repository locks/reads the persisted description, validates owner/category, updates the exact active expense, and upserts the latest learned rule atomically.
**Rollback:** revert callers/repository method; committed rules may remain unused and financial records are not reversed.

- [x] **RED:** Extend `test/postgres.test.js` fake-transaction coverage for ordered lock/read → fingerprint → update → upsert, persisted-description authority, owner predicates, exact IDs, repeated-rule replacement, row-count checks, missing/deleted/cross-user expense or budget, hash failure, update race, FK/upsert failure, rollback propagation, and no writes after failed validation.
- [x] **GREEN:** Add `recategorizeExpenseAndLearn(expenseId, budgetId)` to `src/postgres.js` and the strict facade, using the designed row locks, in-transaction fingerprint, owner-scoped update, and conflict upsert while preserving `created_at`.
- [x] **TRIANGULATE:** Add real integration cases for latest correction wins, source expense deletion leaves the rule, budget deletion removes it, forced upsert failure rolls back the expense and prior rule, cross-user attempts write nothing, and concurrent corrections serialize to a matching final expense/rule pair.
- [x] **REFACTOR:** Keep `updateExpenseBudget` only for historical compatibility, expose no learning or update-only fallback from `src/notion.js`, and run focused repository/storage tests plus approved disposable PostgreSQL integration tests.

## WU 7 — Orchestrate explicit, learned, inferred, and correction success paths

**Start:** omitted categories always call the provider and callbacks use update-only correction.
**Finish:** selection order is explicit → learned → one provider call, correction uses the transaction API, and every success converges on the existing exactly-once expense flow.
**Rollback:** revert bot orchestration and redeploy the pre-feature image; no data reversal.

- [x] **RED:** Extend `test/bot.test.js` for explicit path skipping learned/provider calls, learned hit skipping provider, stale/miss falling through once, high-confidence top candidate, no SQL/description passed by correction callback, exact selected IDs, and correction success/failure replies. Preserve existing cents, app-local date seam, daily total, confirmation text, inferred/learned category display, and exact `Cambiar`/`Eliminar` callbacks.
- [x] **GREEN:** Update `src/bot.js` to fingerprint only omitted-category messages, call `findLearnedBudget` before reading/invoking provider inference, validate explicit/current categories, route accepted candidates through one shared `createExpenseAndGetTotalToday` call, and replace callback use of `updateExpenseBudget` with `recategorizeExpenseAndLearn`.
- [x] **TRIANGULATE:** Assert exact call order/counts for all selection sources, stale learned fallback, write/provider failures, cross-user/current-category rejection seams, cent-rounding edge cases, and near-timezone-boundary success behavior.
- [x] **REFACTOR:** Keep SQL, callback-derived fingerprints, pending state, and Takenos out of `src/bot.js`; run `node --test test/bot.test.js test/storage.test.js test/postgres.test.js`.

## WU 8 — Return safe, complete low-confidence resend choices

**Start:** low confidence is a generic failure with no actionable validated alternatives.
**Finish:** 2–3 safe complete resend examples are emitted only at `<=4096` UTF-16 units; all other inference failures use one deterministic short response and write nothing.
**Rollback:** revert the pure reply builder and bot branch; no pending or expense data exists to clean up.

- [x] **RED:** Add focused `test/bot.test.js` (or `test/categoryResponses.test.js`) cases for defensive ID dedupe/rank/cap, complete original input plus exact multi-word category names, invalid/stale/cross-user exclusion, no callbacks/pending writes, exactly `4096` acceptance, `4097` fallback, BMP and surrogate-pair fixtures, fewer than two choices, timeout/HTTP/malformed/no-valid-candidate failures, and zero expense writes.
- [x] **GREEN:** Add/export `buildLowConfidenceReply`, `MAX_TELEGRAM_MESSAGE_UTF16`, and one generic safe-response constant in `src/categoryResponses.js` or `src/bot.js`; wire low top confidence to complete resend examples and all unsafe/failed cases to the same generic response.
- [x] **TRIANGULATE:** Prove the helper trims only surrounding original input, never truncates a line/name, never fabricates a choice, uses JavaScript `.length`, and does not display reasons; prove lower-ranked high confidence does not override a low-confidence first candidate.
- [x] **REFACTOR:** Keep response construction pure and Telegram parse-mode/callback free; run its focused test plus `node --test test/bot.test.js`.

## WU 9 — Complete integration, deployment gates, verification, and review ledger

**Start:** units pass focused tests but release safety and production actions are unconfirmed.
**Finish:** local verification is complete, reviewer evidence is auditable, and production migration/cutover remain explicit unexecuted confirmation gates.
**Rollback:** revert the single application PR or redeploy the recorded pre-feature image; retain migration 003 and learned data.

- [x] **RED:** Add any missing end-to-end repository/bot regression cases in their owning test files; update the clean-database expectation in `test/postgres.integration.test.js` to exactly `001`, `002`, `003` then `[]`. Record any unavailable disposable database as a release blocker.
- [x] **GREEN:** Update `.env.example` and `README.md` with Node 22 pinning, exact `STORAGE_BACKEND=postgres`, multi-word syntax, normalization/privacy, one-request 8-second bound, Telegram fallback, migration-first deployment, pre-feature-image rollback, retained learning table, and no reverse migration. Document that `src/notion.js` is historical only.
- [x] **TRIANGULATE:** Run `npm test`, approved `npm run test:postgres`, `git diff --check`, `npm audit` (record findings without unapproved dependency churn), and searches proving no Takenos flow, no Notion feature API, no direct SQL in bot/notifications, no secrets/payload/fingerprint logging, and no remote service access.
- [x] **REFACTOR:** Review the diff in WU order, remove duplication/dead compatibility shims, rerun all verification, and finalize `apply-progress.md`, `verify-report.md`, and `review-ledger.md` with commands, outcomes, changed lines, residual risks, and rollback boundaries.
- [x] **Review gate:** Perform full risk, resilience, readability, and reliability review because the PR exceeds 400 lines; resolve confirmed findings and record disposition per work unit in `review-ledger.md`.
- [x] **Budget gate:** Measure `git diff --numstat` (`additions + deletions`). Stop and ask for a chained strategy if actual or revised forecast exceeds 3,500; do not silently exceed the exception.
- [x] **Production migration confirmation gate — remote mutation, do not execute automatically:** obtain explicit user/operator confirmation of target environment, backup/rollback readiness, migration runner exclusivity, and approved production credentials before applying `003`. After approval, record migration row, empty/preexisting row count, check/FK/index/RLS/revokes, and keep the old image running while validating schema.
- [ ] **Production cutover confirmation gate — remote mutation, separate from migration:** only after migration evidence is accepted, obtain explicit confirmation to deploy the Node 22 image with exact PostgreSQL backend. Start one instance, confirm preflight precedes polling/scheduling/provider traffic, then run approved non-sensitive smoke checks for explicit, learned-after-correction, high-confidence, normal/oversized low-confidence, timeout, `Cambiar`, and `Eliminar`.
- [x] **Rollback readiness gate:** identify the exact pre-feature image/commit before cutover; confirm rollback redeploys it, does not select Notion in the new image, does not rewrite expenses/categories, and leaves `category_inference_rules` intact. Production migration, cutover, rollback, commit, push, and PR operations remain unperformed until their respective explicit approvals.

## Confirmed-review remediation

- [x] CAT-R1-001 / CAT-R2-004: reject every undelimited input with multiple decimal tokens; preserve one-number forms and literal `|` categories.
- [x] CAT-R4-001: default production handlers to exact structured coarse stderr reporting; keep injection and harmless reporter failures.
- [x] CAT-R2-002: removed/fixed.
- [x] CAT-R4-003: preserve primary transaction errors, surface rollback/release failures, and await release; fixed after focused RED tests passed.
- [x] CAT-R2-001: reject malformed/coercive candidate shapes and remove dead `selectInferredBudget`.
- [x] CAT-R3-002: retain normal integration skip and require `TEST_DATABASE_URL` for `test:postgres`.
- [x] CAT-R4-002: verified with backup and exact pre-feature deployment/commit rollback evidence.
- [x] CAT-R2-003 / CAT-R3-001: verified after the explicitly approved safe `.env.example` update.
- [x] CAT-R4-004: info/deferred; pre-existing Telegram acknowledgement/idempotency limitation.

## Review Ledger Template

Create `openspec/changes/improve-category-inference/review-ledger.md` during apply and maintain one row per work unit:

| WU | RED evidence | GREEN evidence | TRIANGULATE evidence | REFACTOR evidence | Changed lines | 4R review/disposition | Rollback boundary |
|---|---|---|---|---|---:|---|---|
| 1–9 | command + expected failure | focused pass | boundary/regression pass | post-refactor pass | additions + deletions | risk/resilience/readability/reliability findings | unit-specific revert or operational action |

The ledger must also record the final total against the 3,500 hard budget, disposable PostgreSQL target approval, all remote actions not performed, production migration/cutover confirmation status, exact rollback image/commit status, and any unresolved blocker.
