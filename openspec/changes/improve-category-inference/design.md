# Design: Safe bilingual category inference with private correction learning

## Decision summary

Implement the change as small pure parsing, normalization, prompt-building, and response-validation functions around two new PostgreSQL-only storage-facade operations. PostgreSQL is the required application backend, not merely the preferred learning store. Every new-release application entrypoint fails startup unless it runs on Node.js 22 and `STORAGE_BACKEND` is explicitly `postgres`. The bot orchestrates category selection but contains no SQL and sends every successful explicit, learned, or inferred selection through the existing single expense-write/confirmation path.

The selection order is:

1. exact explicit current category;
2. same-user learned rule joined to a current same-user budget;
3. one bounded OpenRouter request returning validated ranked candidates;
4. either auto-accept the top valid candidate at `>= 0.7`, or write nothing and return safe resend guidance.

Migration `003_category_inference_rules.sql` is additive and may be deployed before the application. Emergency rollback redeploys the pre-feature application image/commit; the new image never degrades to Notion or skips learning. No schema or data rollback is performed.

## Scope and invariants

- Stored budget IDs and exact stored names are authoritative. Static catalog text is prompt-only advice.
- “Current/active budget” means an existing row in `budgets`; the current schema has no inactive or soft-delete column. If one is added later, both budget reads and the learned-rule join must add its active predicate together.
- Takenos, pending drafts, one-tap low-confidence choices, fuzzy learning, and provider retries remain out of scope.
- Existing money rounding, app-local date, daily total, expense creation transaction, confirmation text, and exact-expense action callbacks remain unchanged.
- Node.js 22.x (`>=22 <23`) is the runtime contract for `AbortSignal.timeout`, NFKC normalization, ECMAScript whitespace, lowercase, and JavaScript string behavior.
- The new application has one supported backend: explicit `STORAGE_BACKEND=postgres`. Unset, `notion`, misspelled, or other values fail startup before handlers, schedulers, or provider calls begin.
- Atomic correction-and-learning and current-user ownership are unconditional. The existing Notion adapter remains unchanged for historical rollback/migration code and receives no feature, best-effort, or no-op learning APIs.

## Modules and concrete APIs

### `src/parseMessage.js`

```js
export function parseMessage(text)
// -> { description: string, amount: number, category: string | null }
```

Accept only finite tokens matching explicit decimal syntax. Without `|`, the rightmost decimal is the amount and following tokens are the category, but a final numeric token with an earlier amount-like token and intervening category text fails closed. The literal `{description} {amount} | {category}` form resolves numeric-suffixed or multi-word categories. Comma, hex, binary, and exponent forms are rejected.

### `src/descriptionFingerprint.js` (new)

```js
export function normalizeDescription(description) // -> string
export function fingerprintDescription(description) // -> 64-char lowercase hex string
```

`normalizeDescription` performs these operations in this exact order:

1. require a string;
2. Unicode normalize with `NFKC`;
3. trim leading/trailing ECMAScript whitespace;
4. collapse each internal ECMAScript whitespace run (`/\s+/gu`) to one ASCII space;
5. apply locale-independent JavaScript `toLowerCase()`.

Diacritics are preserved: `cafe` and `café` are different rules. Compatibility-equivalent characters normalized by NFKC are equivalent. No transliteration, punctuation removal, stemming, or fuzzy matching occurs. JavaScript lowercase behavior under the required Node.js 22.x runtime is the versioned contract; it is not locale-sensitive Turkish casing or full linguistic case folding. `package.json` declares `"engines": { "node": ">=22 <23" }`, deployment pins Node 22, and application preflight rejects a different major before starting.

`fingerprintDescription` hashes the UTF-8 bytes of that normalized string with Node `createHash('sha256')` and returns lowercase hexadecimal. It throws if normalization produces an empty string. Tests use published SHA-256 vectors and equivalence/non-equivalence tables; no crypto mock is needed.

### `src/categorySemantics.js` (new)

```js
export function normalizeCategoryAlias(name) // NFKC, trim/collapse, lowercase
export function buildCategoryGuidance(budgets)
// -> [{ name, semantics?, examples? }]
```

A frozen, versioned catalog maps normalized exact aliases to static bilingual boundaries and examples. Initial families cover `Housing`/`Vivienda`/`Hogar`, `Lodging`/`Alojamiento`, `Investments`/`Inversiones`, `Shopping`/`Compras`, `Food`/`Comida`/`Alimentación`, `Transport`/`Transporte`, and `Travel`/`Viajes`. Housing versus temporary lodging and financial investments versus purchased goods are explicit in both Spanish and English.

Only an exact normalized alias receives catalog text. The emitted `name` is always the exact stored budget name. Unknown names emit `{ name }` only. The catalog never supplies an output category not present in `budgets`.

### `src/inferCategory.js`

```js
export const MIN_CONFIDENCE = 0.7;
export const OPENROUTER_TIMEOUT_MS = 8_000;

export function findBudgetByName(budgets, name) // exact case-insensitive, or null
export function buildInferenceRequest({ description, amount, budgets, model })
// -> OpenRouter JSON request body; pure and contains no authorization data
export function extractCandidatePayload(openRouterPayload)
// -> parsed { candidates } from choices[0].message.content; throws if absent/invalid
export function validateRankedCandidates(payload, budgets)
// -> [{ budgetId, categoryName, confidence, reason }]
export function selectTopCandidate(candidates, minConfidence = MIN_CONFIDENCE)
// -> candidate | null
export async function inferCategory(
  { description, amount, budgets },
  { fetchImpl = globalThis.fetch,
    timeoutMs = OPENROUTER_TIMEOUT_MS,
    createTimeoutSignal = AbortSignal.timeout,
    apiKey = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL } = {},
)
// -> validated candidate[]; throws on transport/schema/no-valid-candidate failure
```

`buildInferenceRequest`, `extractCandidatePayload`, and `validateRankedCandidates` split prompt construction, OpenRouter-envelope parsing, and the local trust boundary into pure testable steps. `inferCategory` rejects a missing API key, an empty budget allowlist, or an invalid timeout before issuing a request. Otherwise it builds bilingual guidance, creates exactly one timeout signal by calling `createTimeoutSignal(timeoutMs)` once, and passes that same signal to exactly one `fetchImpl` call. The signal remains attached while the response body is consumed. It performs no retry on HTTP failure, abort, response parsing failure, or schema failure. `timeoutMs` must be a positive finite integer no greater than the exported default; production therefore cannot accidentally become unbounded. The injectable fetch, signal factory, key, and model make request count and abort behavior deterministic in unit tests without mutating globals or using fake timers.

The provider request uses this exact OpenRouter wrapper; `CANDIDATE_SCHEMA` below is the literal schema object, not a prose-only equivalent:

```js
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'expense_category_candidates',
    strict: true,
    schema: CANDIDATE_SCHEMA,
  },
}
```

`CANDIDATE_SCHEMA` is:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["candidates"],
  "properties": {
    "candidates": {
      "type": "array",
      "minItems": 1,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["categoryName", "confidence", "reason"],
        "properties": {
          "categoryName": { "type": "string", "minLength": 1 },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "reason": { "type": "string", "maxLength": 240 }
        }
      }
    }
  }
}
```

Local validation repeats the trust boundary rather than relying on provider enforcement:

- top level must be a non-array object with exactly the own key `candidates`;
- `candidates` must contain one through three entries;
- each retained entry must be a non-array object with exactly the own keys `categoryName`, `confidence`, and `reason`;
- `categoryName` must be a string with at least one UTF-16 code unit; `reason` must be a string with at most 240 UTF-16 code units; confidence must satisfy `typeof === 'number'`, `Number.isFinite`, and `[0, 1]`;
- name resolves only by exact case-insensitive comparison to the supplied current budgets;
- the result substitutes the budget ID and exact stored spelling;
- duplicates after resolution are dropped, preserving the earliest valid rank;
- malformed individual candidates—including extra/missing keys or violations of any string/number bound—are dropped, but a malformed envelope or array cardinality rejects the response;
- zero retained candidates is a safe inference failure.

`extractCandidatePayload` additionally requires the OpenRouter envelope to expose `choices[0].message.content` as a string containing one JSON value. It does not accept Markdown fences, object recovery, coercion, or alternate provider fields. The parsed logical payload then goes through the exact local checks above.

Reasons are neither displayed, persisted, nor logged. `selectTopCandidate` considers the first retained candidate only and preserves `0.7`; it does not promote a lower-ranked candidate over a valid low-confidence first candidate.

### Runtime and backend preflight: `src/runtimeConfig.js` (new) and `src/storage.js`

```js
export function assertRuntimeAndBackend({
  nodeVersion = process.versions.node,
  storageBackend = process.env.STORAGE_BACKEND,
} = {}) // -> void; throws a configuration error otherwise
```

The check accepts only Node major `22` and the exact backend string `postgres`; it does not trim, case-fold, default, or interpret aliases. `bot.js` and `notifications.js` call it before constructing storage, registering handlers/jobs, opening provider traffic, or beginning polling. Tests exercise unset, `notion`, case variants, unknown values, Node 21/23, and the accepted Node 22 + PostgreSQL pair. `package.json` also declares `"engines": { "node": ">=22 <23" }`; `.env.example`, README, and deployment configuration explicitly set `STORAGE_BACKEND=postgres` and pin Node 22.

`src/storage.js` removes the application singleton's `?? 'notion'` default. The deployed singleton is constructed only after preflight and only from `createDefaultPostgresRepository()`. The existing generic factory and `src/notion.js` may remain for migration utilities and historical tests, but the new application entrypoints cannot select them.

Add these methods to the PostgreSQL feature method set and export them from the strict application facade:

```js
findLearnedBudget(descriptionFingerprint)
// -> Promise<{ id, name } | null>

recategorizeExpenseAndLearn(expenseId, budgetId)
// -> Promise<void>
```

Do not require feature-method parity from the Notion repository. Keep base methods separate from PostgreSQL feature methods so a historical Notion factory exposes only its existing API rather than wrappers that fail late. The bot supplies a fingerprint only for lookup. It does **not** supply an expense description or fingerprint during correction; the PostgreSQL repository obtains the persisted description of the exact expense in the correction transaction. This prevents callback data or stale bot state from teaching the wrong description.

### PostgreSQL repository: `src/postgres.js`

`findLearnedBudget(fingerprint)` resolves the configured user and executes one owner-scoped join:

```sql
SELECT b.id, b.name
FROM category_inference_rules AS r
JOIN budgets AS b
  ON b.id = r.budget_id
 AND b.user_id = r.user_id
WHERE r.user_id = $1
  AND r.description_fingerprint = decode($2, 'hex')
LIMIT 1
```

Validate the fingerprint as exactly 64 lowercase hex characters before querying. This join—not a rule-only read—ensures the category still exists in the current same-user budget set. The explicit `r.user_id` predicate remains required even for service roles that bypass RLS. If no joined row exists, return `null` and continue to provider inference.

`recategorizeExpenseAndLearn(expenseId, budgetId)` resolves `userId`, then runs one `database.transaction`. Immediately after `BEGIN`, it issues fixed `SET LOCAL statement_timeout = '5s'` and `SET LOCAL lock_timeout = '1s'`; setup failure uses the transaction's rollback/release path.

1. Lock and read the existing description while validating both resources in the same transaction:

   ```sql
   SELECT e.description
   FROM expenses AS e
   JOIN budgets AS b
     ON b.id = $2
    AND b.user_id = e.user_id
   WHERE e.id = $1
     AND e.user_id = $3
     AND e.deleted_at IS NULL
   FOR UPDATE OF e
   FOR KEY SHARE OF b
   ```

   Require exactly one row. This explicitly obtains the persisted expense description **inside the PostgreSQL transaction**, before either write, and locks the expense against concurrent deletion/recategorization while preventing concurrent removal of the selected budget.

2. Compute `fingerprintDescription(row.description)` in application code while the transaction remains open.
3. Update the already locked exact active expense with owner predicates:

   ```sql
   UPDATE expenses
   SET budget_id = $2, updated_at = now()
   WHERE id = $1 AND user_id = $3 AND deleted_at IS NULL
   ```

   Require `rowCount === 1`.
4. Upsert the latest rule:

   ```sql
   INSERT INTO category_inference_rules
     (user_id, description_fingerprint, budget_id)
   VALUES ($1, decode($2, 'hex'), $3)
   ON CONFLICT (user_id, description_fingerprint)
   DO UPDATE SET budget_id = EXCLUDED.budget_id, updated_at = now()
   ```

5. Commit only after both writes succeed. Any missing/deleted/cross-user resource, hash error, update race, FK failure, or upsert failure throws and causes the database wrapper to roll back both writes. `created_at` remains the first-learned timestamp; `updated_at` records replacement.

The existing `updateExpenseBudget` can remain for compatibility, but the bot correction handler switches only to the facade operation above.

### Existing Notion adapter: `src/notion.js`

Make no changes. In particular, do **not** add `findLearnedBudget`, `recategorizeExpenseAndLearn`, a no-op lookup, an update-only correction fallback, or any best-effort learning behavior. The file remains solely as historical rollback/migration code. Operational rollback is performed by redeploying the pre-feature image/commit that already knows how to use that adapter; `STORAGE_BACKEND=notion` is rejected by the new image.

## Migration `003_category_inference_rules.sql`

The migration runs once inside the existing migration-runner transaction and contains no backfill:

```sql
CREATE TABLE category_inference_rules (
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  description_fingerprint BYTEA NOT NULL
    CHECK (octet_length(description_fingerprint) = 32),
  budget_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, description_fingerprint),
  FOREIGN KEY (budget_id, user_id)
    REFERENCES budgets(id, user_id) ON DELETE CASCADE
);

CREATE INDEX category_inference_rules_budget_user_idx
  ON category_inference_rules (budget_id, user_id);

ALTER TABLE category_inference_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON category_inference_rules FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON category_inference_rules FROM authenticated;
  END IF;
END
$$;
```

The primary key enforces one latest rule per user/fingerprint and is the lookup index. The composite FK enforces same-user budget ownership; `ON DELETE CASCADE` removes rules for physically deleted budgets, so no stale rule blocks category deletion. The secondary index supports FK/delete checks by budget. User deletion removes private rules. No expense FK exists, allowing a rule to outlive its source expense.

As with current production tables, RLS is enabled with no client policies, and `anon`/`authenticated` receive no table privileges. The service connection must still use owner predicates because it may bypass RLS. The runner's `schema_migrations` row makes repeat execution a no-op; raw partial application is prevented by the enclosing transaction.

## Bot data flow and response construction

### Expense message

1. Parse and apply existing cent rounding.
2. If an explicit category exists, resolve it through the owner-scoped storage lookup and continue to the shared success path; no learning lookup or provider request occurs.
3. Otherwise compute the fingerprint locally and call `findLearnedBudget`.
4. On a learned hit, use its exact ID/name and continue to the shared success path; do not call OpenRouter.
5. On a miss, read current budgets and call `inferCategory` once.
6. If the first validated candidate is `>= 0.7`, use its ID/name and continue to the shared success path.
7. If valid candidates exist but the first is below `0.7`, create no expense. Pass at most the first three validated candidates to a pure reply builder, which emits complete choices only at `<= 4096` UTF-16 code units and otherwise emits the deterministic generic response.
8. On timeout, provider/HTTP error, malformed envelope, or no valid candidates, create no expense and return the same generic safe rejection.
9. The shared success block calls `createExpenseAndGetTotalToday` exactly once and preserves its existing confirmation, daily total, and buttons. Learned selection is presented like inferred selection because the user omitted a category.

### Pure low-confidence helper

Add in `src/bot.js` or a small `src/categoryResponses.js` module:

```js
export function buildLowConfidenceReply({ originalText, candidates })
// -> string
```

The input candidates are already validated and carry exact stored names. Deduplicate defensively by `budgetId`, retain rank, and cap at three. Export `MAX_TELEGRAM_MESSAGE_UTF16 = 4096` and a constant generic safe response whose `.length` is below that limit. If two or three candidates remain, first construct the complete multi-choice reply by trimming the original omitted-category message and appending one space plus the full category name to every line, for example:

```text
No pude elegir una categoría con seguridad. Reenviá una de estas opciones:
• hotel 50 Travel and Lodging
• hotel 50 Travel
```

This preserves the user's complete description and amount spelling and supports multi-word names. It does not use Markdown parsing or callbacks. Measure the fully constructed reply with JavaScript `.length`, i.e. deterministic UTF-16 code units under Node.js 22. Return it only when `reply.length <= 4096`; if it is `4097` or longer, return the constant generic safe response rather than truncating the original input, category names, or individual choices. The conservative UTF-16 count may reject some astral-character text earlier than Telegram requires, but can never send an over-limit reply under this contract. If fewer than two choices remain, also return the same generic response and fabricate nothing. No write or pending state occurs on any branch.

### Manual `Cambiar`

The category-list callback still reads current budgets and encodes exact IDs. `set-category` still verifies the chosen ID is in that just-read list, then calls `recategorizeExpenseAndLearn(expenseId, budget.id)`. The repository repeats authoritative owner/current checks and reads the expense description in its transaction. Bot code never hashes callback state and never issues SQL.

## Failure and concurrency behavior

| Failure | Result |
| --- | --- |
| Learned miss/stale deleted category | Joined lookup returns no row; continue to provider. |
| Provider timeout/HTTP/invalid JSON/schema/no valid candidate | No expense write; generic safe resend response; no retry. |
| Low top confidence with 2–3 valid candidates and reply length `<= 4096` UTF-16 units | No write; complete resend examples only. |
| Low-confidence reply length `> 4096` UTF-16 units | No write; deterministic constant generic safe response; no truncation. |
| Low top confidence with fewer than 2 valid candidates | No write; the same generic safe resend response. |
| Expense deleted before manual correction lock | Transaction fails before writes. |
| Budget removed/cross-user before correction | Join fails or FK rejects; transaction writes nothing. |
| Rule upsert fails after expense update | transaction rollback restores prior expense and rule. |
| Concurrent corrections of one expense | row lock serializes them; the later committed correction and rule win together. |
| Same fingerprint for different users | composite primary key and every owner predicate isolate rules. |

## Privacy and observability

Fingerprints are pseudonymous, not anonymous; common descriptions remain dictionary-guessable. Store only the 32-byte SHA-256 digest in the rule table and retain no duplicate normalized plaintext or provider reason. Existing expense descriptions remain in `expenses` under their existing retention behavior.

Never log descriptions, normalized descriptions, fingerprints, request/response payloads, category history, authorization headers, API keys, or provider reasons. OpenRouter receives only the current description, rounded current amount, current exact category names, and static catalog guidance—never rules, fingerprints, previous descriptions, or corrections.

Operational failure reporting defaults to vendor-neutral structured stderr JSON and remains injectable. It receives and writes exactly `{ operation, outcome: 'failure' }` for provider lookup, learned lookup, expense write, or correction write failures. It receives no IDs, names, descriptions, amounts, fingerprints, payloads, tokens, reasons, or `Error`; synchronous or asynchronous reporter failure is swallowed so generic user-facing behavior remains unchanged.

## Test seams and verification plan

| Layer | Seam and focused coverage |
| --- | --- |
| Parser unit | Pure `parseMessage`: old explicit/omitted forms, Spanish/English multi-word names, earlier numbers, finite-only amount, missing amount/description, comma decimals, numeric category suffix ambiguity. |
| Fingerprint unit | Pure normalization and stable SHA-256 vectors; NFKC, whitespace, case, preserved diacritics, distinct normalized strings, empty rejection. |
| Catalog unit | Pure guidance builder: known bilingual aliases, exact stored output spelling, arbitrary name-only fallback, no absent category. |
| Inference unit | Injected fetch and timeout-signal factory; inspect one request and exact JSON schema; bilingual prompt; strict envelope/candidate keys; nonnumeric/NaN/infinite/range failures; invented and duplicate names; exact stored spelling/rank; top threshold boundary; one fetch and one signal; abort/no retry. |
| Runtime/config unit | Pure preflight accepts only Node 22.x plus exact `STORAGE_BACKEND=postgres`; unset/Notion/unknown/case variants and Node 21/23 throw before storage/provider setup. Application entrypoint seams prove preflight precedes side effects. |
| Bot unit | Existing success assertions for cents/text/total/buttons; explicit path skips learning/provider; learned hit skips provider; miss invokes provider once; low confidence performs zero expense writes and shows only 2–3 complete validated examples when the final reply is `<= 4096` UTF-16 units. Assert exact `4096` acceptance and `4097` deterministic generic fallback with BMP and surrogate-pair fixtures; fewer choices/provider errors use the same generic response. Inject all storage/provider operations as current handlers already do. |
| Correction handler unit | Inject `recategorizeExpenseAndLearn`; verify exact expense/budget IDs and success/failure replies; no SQL or description passed by bot. No update-only fallback exists. |
| Storage unit | PostgreSQL application facade exposes both feature methods; startup rejects a Notion application backend; existing Notion adapter exports remain unchanged and gain no learning methods. |
| PostgreSQL repository unit | Fake transaction executor captures ordered lock/read, update, upsert; owner predicates and decode parameters; no writes when validation fails; rollback propagation seam. |
| PostgreSQL integration | On a clean disposable database, the first `runMigrations` expectation is exactly `['001_initial.sql', '002_lock_down_public_schema.sql', '003_category_inference_rules.sql']`, and the second is `[]`; table/RLS/constraints/revokes; 32-byte check; same-user FK success and cross-user FK failure; same fingerprint isolated by user; replacement wins; physical budget deletion removes rule; learned join sees only current same-user budget; source expense deletion leaves rule; real rollback after forced upsert failure; deleted/cross-user expense and budget attempts write nothing. |
| Regression | Full `npm test`; opt-in `npm run test:postgres` with approved disposable `TEST_DATABASE_URL`. No remote Notion, Railway, OpenRouter, or paid service mutation. |

For repository rollback tests, enhance the fake database transaction seam to distinguish transaction queries and expose thrown failures. For provider tests, dependency injection replaces global fetch mocking where practical and lets tests assert exactly one `AbortSignal` instance is passed to exactly one call.

## File change plan

| File | Change |
| --- | --- |
| `migrations/003_category_inference_rules.sql` | Add the private user-scoped rule table, constraints, index, RLS, and revokes. |
| `src/descriptionFingerprint.js` | Pure deterministic normalization and SHA-256. |
| `src/categorySemantics.js` | Static bilingual alias catalog and guidance builder. |
| `src/parseMessage.js` | Rightmost finite amount and multi-word category parsing. |
| `src/inferCategory.js` | Pure request/envelope helpers, strict ranked schema, local validation, bilingual context, one timeout-bound request. |
| `src/runtimeConfig.js` | Fail-fast Node 22.x and exact PostgreSQL backend preflight. |
| `src/storage.js` | Remove the application Notion default; expose learned lookup and transactional correction only from the strict PostgreSQL application facade. |
| `src/postgres.js` | Same-user learned join and atomic lock/read/update/upsert transaction. |
| `src/notion.js` | No change; preserve the existing historical adapter without feature APIs. |
| `src/bot.js` | Run preflight before side effects; selection orchestration, length-safe low-confidence resend construction, new correction operation; no SQL. |
| `src/notifications.js` | Run the same application preflight before scheduler/storage side effects. |
| `package.json`, `README.md`, `.env.example` | Require Node 22.x and explicit `STORAGE_BACKEND=postgres`; document multi-word syntax, learning privacy, pre-feature-image rollback, Telegram fallback, and provider timeout behavior. |
| `test/*.test.js` | Focused unit/regression additions described above. |

## Deployment and rollback

### Safe deployment order

1. Merge only after unit tests and disposable PostgreSQL integration tests pass, including rollback and two-user isolation cases. The clean-database integration assertion MUST expect migrations `001`, `002`, and `003`, in that order.
2. Pin every application process to Node.js 22.x and configure the exact value `STORAGE_BACKEND=postgres`; verify staging startup fails for unset and `notion` values before production rollout.
3. Pause is not required for this additive empty-table migration, but avoid concurrent deploy/migration jobs.
4. Apply `003_category_inference_rules.sql` first. Verify its migration record, empty row count, 32-byte check, composite FK, RLS flag, and `anon`/`authenticated` revokes.
5. Keep the old application running during schema verification; it does not reference the new table.
6. Deploy the new application. Its preflight completes before bot polling, notification scheduling, storage construction, or provider traffic. Start one bot instance and observe only coarse outcome/error rates and provider latency—never payloads.
7. Smoke-test explicit, learned-after-manual-correction, high-confidence, ordinary and oversized low-confidence, timeout/failure, `Cambiar`, and `Eliminar` behavior with approved non-sensitive data.

### Emergency rollback

1. Redeploy the pre-feature application image/commit. Do not change `STORAGE_BACKEND` on the new image as a rollback mechanism; that image must refuse to start with Notion.
2. Confirm the prior image restores its own parser, inference, correction, low-confidence, and storage behavior and makes no learned-rule reads/writes.
3. Do not revert expenses, rename categories, switch live financial writes independently of the prior image's established configuration, or run a reverse migration.
4. Leave `category_inference_rules` and its data intact and inaccessible to client roles.
5. Preserve `src/notion.js` in repository history for the prior image and migration tooling, but add no learning/no-op compatibility methods in this release.
6. Remove the table only in a later migration after proving no deployed version reads or writes it and after an explicit retention decision.

## Review size and workload

Forecast: approximately **1,500–2,100 changed lines**, including roughly 150–250 migration/docs lines, 450–650 production lines, and 900–1,200 test lines. This remains under the chosen 3,500-line single-PR budget.

Reviewer workload is nevertheless **high** because one PR crosses parser compatibility, LLM trust validation, timeout behavior, privacy, storage-facade parity, SQL constraints/RLS, and transactional concurrency. Keep it one PR as requested, but structure commits and review in this order: (1) normalization/parser/catalog, (2) migration/repositories, (3) provider validation, (4) bot orchestration, (5) integration/regression tests and docs. If implementation forecasts exceed 3,500 lines or isolation/transaction review cannot remain coherent, pause before apply and request a delivery decision rather than silently splitting or exceeding the budget.
