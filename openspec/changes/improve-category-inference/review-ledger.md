# Review Ledger: improve-category-inference

| WU | RED | GREEN | TRIANGULATE | REFACTOR | Changed lines (cumulative implementation) | 4R review/disposition | Rollback boundary |
|---|---|---|---|---|---:|---|---|
| 1 | Missing module/facade failures | Runtime/storage focused pass | Version/backend/order/history cases pass | 27 startup/storage tests pass | 219 | Risk: fail-open startup. Resolved with exact preflight, direct-entry preflight, lazy PostgreSQL facade, and ordering seams. Readability: base vs feature methods separated. | Revert runtime/storage/startup changes. |
| 2 | 4 behavior/module failures | 14 parser/fingerprint tests pass | Unicode, finite and ambiguity boundaries | Pure exports retained | 390 | Risk: parser reinterpretation/privacy key drift. Resolved by rightmost finite scan and exact normalization/hash tests. | Revert pure parser/fingerprint files; no data yet. |
| 3 | Missing catalog/schema exports | 13 focused tests pass with WU4 | Strict malformed/rank/allowlist boundaries | Prompt/envelope/trust helpers separated | 745 | Risk: invented categories/reason leakage. Resolved by local exact allowlist, strict own-key/cardinality/range validation, stored identity substitution. | Revert catalog/ranked helpers. |
| 4 | Provider seam imports failed | One request/signal passes | Pre-request 0 calls; failures 1 call | Generic payload-free errors | 845 | Resilience: timeout/retry/payload exposure. Resolved with 8s upper bound, one signal/fetch, no retries, no payload logging. | Revert provider execution, leaving pure helpers unused. |
| 5 | Missing lookup method | Unit + migration pass | Disposable DB constraints/RLS/revokes/isolation | SQL remains repository-only | 1,035 | Security: service-role/RLS bypass. Resolved with explicit owner predicate, joined same-user budget, composite FK, RLS and revokes. | Revert caller/repository; additive table may remain. |
| 6 | Missing transaction method | Ordered unit path pass | Real rollback/concurrency/cascade/source independence | Compatibility update method retained only historically | 1,165 | Reliability: split-brain expense/rule. Resolved with row locks and one transaction; forced-trigger rollback proved. | Revert method/caller; retain learned rows. |
| 7 | Learned order/correction assertions failed | Shared success path pass | Exact call counts/IDs/failure regressions | No SQL/callback fingerprint/pending state | 1,270 | Risk: duplicate writes/stale callback data. Resolved with persisted-description transaction and exactly one shared write. | Revert bot orchestration and deploy pre-feature image. |
| 8 | Missing helper/module | Helper and bot tests pass | UTF-16 4096/4097, dedupe, rank, fewer choices | Pure parse-mode-free helper | 1,345 | Risk: Telegram overflow/unsafe choices. Resolved with full-message `.length`, no truncation, validated candidates only, generic fallback. | Revert helper/branch; no pending data. |
| 9 | 003 expectation authored before migration | Integration/docs mostly pass | Full local verification pass | Reports and review finalized | 1,372 | Operations: safe `.env.example` update and Node 22 full suite pass; production gates remain. No remote action. | Redeploy operator-confirmed pre-feature image; no reverse migration. |
| R | Earlier remediation RED plus final multiple-decimal/default-reporter regressions failed 2/25 | Final parser/bot tests pass 25/25 | One-number forms, delimited numeric category, exact safe output, injection, and reporter rejection covered | Default reporter is minimal JSON; test-only no-op retained | See final measure | CAT-R1-001/CAT-R4-001/CAT-R4-003/CAT-R3-002 verified fixed. R4-002 blocked-operational; R4-004 info/deferred; R2-003/R3-001 verified fixed. | Revert remediation code/tests/docs as one review unit. |

## Full 4R review

- **Risk:** Category authority, privacy, startup configuration, schema ownership, and Telegram message limits were reviewed. Confirmed `.env.example` documentation gap remains open; production gates are deliberately open.
- **Resilience:** One bounded provider call, safe no-write failures, transactional rollback, lock serialization, idempotent migrations, same-user FK and budget cascade were exercised. Disposable PostgreSQL integration passed.
- **Readability:** Pure parser/fingerprint/catalog/response modules and split request/envelope/trust functions reduce orchestration complexity. SQL remains in `src/postgres.js`/migration only.
- **Reliability:** Focused suites and final regression suite pass; real DB tests cover migration order/idempotency, RLS/revokes, owner isolation, rollback, source deletion, cascade and concurrent corrections. Existing cent/date/summary/callback behavior remains green.

## Delivery and operational ledger

- Strategy: approved single PR size exception; no commits created.
- Final exact measure: **3,472 / 3,500** changed lines, 28 lines headroom, including implementation and OpenSpec artifacts.
- Disposable PostgreSQL: Docker `postgres:16-alpine`, local loopback port 55439, test-only credentials, container removed after pass.
- Remote actions: secure logical backup created; migration 003 applied/verified empty with RLS/revokes; issue #3 created. Cutover, commit, push, and PR remain pending.
- Production migration: explicitly authorized; 003 applied once, rule rows 0, RLS on, anon/authenticated denied.
- Production cutover confirmation: not requested/not granted.
- Rollback ready: commit `14b2907`; bot deployment `3556c88e-942d-4bad-9302-7fa48a02d1a3`; notifications `b91bf464-3aad-4438-a438-2b2bb15cd222`; secure backup mode 600.
- Documentation blocker resolved: user approved a no-secret `.env.example` update; PostgreSQL startup variables are present.
