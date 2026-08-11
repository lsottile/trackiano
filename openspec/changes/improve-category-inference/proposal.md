# Proposal: Improve Category Inference Safely

## Intent

Make expense categorization more accurate and actionable for Spanish, English, and mixed-language descriptions while preserving exact user-defined category names and the current successful expense flow.

The first slice combines clearer bilingual inference, explicit multi-word categories, and private exact-description learning from manual recategorization. It keeps one bounded OpenRouter request when local learning cannot answer and never creates an expense from a low-confidence choice. This release requires Node.js 22 and `STORAGE_BACKEND=postgres`; application startup fails closed if the backend is unset or has any other value.

## Problem and outcome

Today, inference receives mostly bare category names, cannot reliably express category boundaries, and treats low-confidence results as a generic resend failure. Explicit categories are limited to one token, and a user's manual correction does not improve later categorization of the same description.

After this change:

- Spanish, English, and mixed descriptions receive bilingual semantic guidance;
- stored category names remain the authoritative output and allowlist;
- users can specify an explicit multi-word category;
- repeating an exactly normalized description can reuse that user's latest manual recategorization without calling OpenRouter;
- low-confidence inference returns safe, complete resend examples using valid current categories;
- existing successful expenses retain their write, reply, total, and action behavior.

## Product decisions

| Area | First-slice decision |
| --- | --- |
| Language | Support Spanish, English, and mixed descriptions. |
| Category authority | Match and return exact stored category names; never translate, rename, or invent them. |
| Semantic guidance | Use a static bilingual semantics/example catalog for known exact aliases and a safe name-only fallback for arbitrary categories. |
| Explicit input | Support multi-word category names after the amount while retaining existing valid forms. |
| Learning | Learn only exact normalized descriptions from manual Telegram recategorization, scoped to the current user in PostgreSQL. |
| Low confidence | Write nothing and show complete resend examples for validated current categories. |
| Provider use | Use at most one OpenRouter request per inference attempt, with a bounded timeout. Local learned matches use no provider request. |
| Runtime | Require Node.js 22 for the versioned `AbortSignal.timeout` and Unicode normalization/lowercasing behavior. |
| Storage gate | Require the explicit value `STORAGE_BACKEND=postgres`; the new application MUST fail startup when it is unset or different. Notion is not a degraded runtime mode for this release. |
| Rollback | Redeploy the pre-feature application image/commit. Keep the additive table and existing Notion adapter code, but add no Notion learning or best-effort correction APIs. |

## Scope

### Included

- Parse an explicit multi-word category from the text following the applicable numeric amount, with backward compatibility for current successful inputs.
- Enrich current categories with static bilingual boundaries and examples only where an exact normalized catalog alias matches.
- Fall back to the exact stored name without fabricated semantics for arbitrary user-created categories.
- Request ranked category candidates in the existing single OpenRouter call and validate confidence, uniqueness, ordering, and exact membership locally.
- Preserve the current auto-accept threshold for the top valid candidate.
- Add a bounded OpenRouter timeout and fail safely without retries that would exceed one request.
- On low confidence, create no expense and provide complete resend examples for a small set of validated candidates, including multi-word names where applicable; if the complete reply would exceed Telegram's 4,096-character message limit, deterministically use the short generic safe resend response instead.
- Store user-scoped PostgreSQL rules that map an exact normalized description fingerprint to the latest manually selected category.
- Consult a valid learned rule before OpenRouter.
- Update the expense category and its learning rule atomically during every manual recategorization; there is no backend-specific exception in the new release.
- Fail application startup unless the runtime is Node.js 22 and `STORAGE_BACKEND` is explicitly `postgres`.
- Preserve the existing Notion adapter only as historical rollback/migration code; do not add learned lookup or best-effort/no-op recategorization APIs to it.
- Add focused parser, inference, bot, storage, migration, and PostgreSQL isolation coverage, with PostgreSQL integration expectations including migration `003_category_inference_rules.sql`.

### Non-goals

- One-tap low-confidence choices or durable pending expense drafts.
- Editable per-category semantic metadata.
- Fuzzy matching, embeddings, merchant generalization, or model training.
- Takenos integration or data.
- Telegram Mini App or shared API work.
- Category translation or automatic renaming.
- Sending correction history or previous descriptions to OpenRouter.
- Changing confidence calibration beyond retaining the current threshold.
- Localized comma-decimal parsing or a new quoted/delimited input grammar.

## Behavioral boundaries

### Successful expenses

The existing successful explicit, learned, and high-confidence paths must continue to create exactly one expense with current cent rounding, app-local date behavior, daily total behavior, confirmation text, and `Cambiar`/`Eliminar` actions. A learned match changes only how the category is selected; it must not bypass current ownership or active-category checks.

### Category safety

Every explicit, learned, inferred, or suggested category must resolve to a current category owned by the user. Exact stored spelling is authoritative in writes and user-facing output. Catalog semantics are advisory prompt context, not category definitions.

### Learning lifecycle

Manual recategorization replaces the rule for the same user and normalized description. Rules are user-scoped, reference a same-user category, and may outlive the source expense. A rule whose category is no longer valid must fail closed and continue through normal inference rather than selecting stale data.

### Failure and ambiguity

Malformed model output, timeout, provider failure, or absence of valid candidates must create no expense and retain a safe resend response. Injected failure reporting carries only coarse operation/outcome enums and cannot affect user behavior. Low-confidence resend examples contain only validated current categories and fall back safely above 4,096 UTF-16 units. Amounts accept finite decimal syntax only. Ambiguous undelimited numeric category suffixes fail closed and use the explicit `{description} {amount} | {category}` form.

## Affected areas

- `src/parseMessage.js`: multi-word explicit category parsing.
- `src/inferCategory.js`: bilingual catalog context, ranked output validation, exact allowlisting, and bounded single-request behavior.
- `src/bot.js`: PostgreSQL-backend startup gate, learned-rule lookup, unchanged success flow, length-safe low-confidence resend examples, and correction learning orchestration.
- Storage/PostgreSQL repository: user-scoped rule lookup and transactional recategorization plus rule upsert, without SQL in bot code. The existing Notion adapter is unchanged and receives no feature API additions.
- PostgreSQL migrations: additive correction-rule table, ownership constraints, indexes, RLS, and privilege lockdown.
- Tests: parser compatibility, bilingual inference, arbitrary categories, one-request/timeout behavior, no-write low confidence, transactional learning, and cross-user isolation.

## Data and migration safety

The migration is additive and starts with an empty learning table; no expense or category backfill is required. The table must use the existing user identifier, a deterministic description fingerprint, and a same-user composite category foreign key. RLS and revoked `anon`/`authenticated` privileges must match current production tables.

Before enabling learning, tests must verify same-user foreign-key enforcement, owner predicates on every lookup/write, replacement of a repeated rule, stale/deleted category handling, and atomic rollback when recategorization or rule persistence fails. Description fingerprints are pseudonymous rather than anonymous and must not be logged or sent to OpenRouter as history.

## Success criteria

- Existing successful expense tests continue to pass without duplicate writes or regressions in cents, dates, daily totals, confirmation, or action callbacks.
- Explicit Spanish or English multi-word stored category names can be selected while existing valid message forms still work.
- Inference handles Spanish, English, and mixed descriptions using bilingual guidance, while every accepted or suggested result exactly matches a current stored category.
- Known catalog aliases receive static semantics/examples; arbitrary categories remain eligible through safe name-only fallback.
- A valid learned exact-description rule selects the user's current category without an OpenRouter request.
- Manual recategorization atomically updates the expense and replaces the user's rule for that normalized description.
- PostgreSQL tests prove that rules and recategorizations cannot cross user boundaries.
- Each non-local inference attempt makes no more than one OpenRouter request and completes or fails within a bounded timeout.
- Low-confidence inference writes nothing and returns only safe, complete resend examples when the reply fits Telegram's limit; oversized replies deterministically fall back to the short generic response. Provider and malformed-output failures also write nothing.
- New-release startup rejects an unset or non-`postgres` `STORAGE_BACKEND`, runs on Node.js 22, and PostgreSQL integration tests expect migrations `001`, `002`, and `003`.
- The implementation remains within the single-PR 3,500 changed-line review budget.

## Risks and mitigations

- **Uncalibrated confidence:** retain the existing threshold and validate all candidates locally; defer threshold tuning until outcomes can be measured.
- **Static semantics mismatch:** apply catalog entries only to exact normalized aliases and use name-only fallback for everything else.
- **False learning:** limit learning to exact normalized descriptions and let the latest manual correction replace the rule.
- **Privacy:** store only a deterministic fingerprint for matching, keep it user-scoped, avoid logging descriptions/fingerprints/model payloads, and never send history to the provider.
- **Parser ambiguity:** preserve known successful forms and explicitly defer numeric category suffixes, comma decimals, and broader grammar changes.
- **Stale categories:** validate learned and suggested categories against the user's current active categories and fail closed.
- **Latency/provider failure:** check local rules first, issue one bounded provider request at most, and create no expense on failure.
- **Transactional drift:** combine recategorization and learning upsert in one repository transaction protected by existing ownership constraints.

## Deployment and rollback

The new application image MUST run on Node.js 22 and MUST fail startup unless `STORAGE_BACKEND=postgres` is explicitly configured. There is no supported Notion or best-effort learning mode in this release: transactional learning and current-user ownership checks are unconditional.

Emergency rollback means redeploying the pre-feature application image/commit, which restores its prior parser, inference, correction, low-confidence, and storage behavior and thereby performs no learned-rule reads or writes. Operators MUST NOT attempt rollback by selecting Notion in the new image. The repository's existing Notion adapter remains unchanged solely for historical rollback/migration code; this change adds no learned lookup, no no-op learning, and no update-only `recategorizeExpenseAndLearn` method to it.

Do not drop learning data as part of an emergency application rollback. A later migration may remove the table only after confirming no deployed code reads or writes it. Because this slice adds no backfill and does not alter stored category names or successful expense records, rollback requires no reverse data migration.
