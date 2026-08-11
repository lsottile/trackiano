# Exploration: Improve Category Inference

## Problem and boundaries

Category inference currently sends an expense description, amount, and bare allowed category names to OpenRouter, accepts one exact-name result at model-reported confidence `>= 0.7`, and otherwise asks the user to resend. The direction is to improve Spanish/English inference, explain category boundaries with examples, accept explicit multi-word names, learn from Telegram recategorizations, and offer low-confidence choices.

This change must preserve the existing successful expense path: cent rounding, one exact expense write, app-local date/daily total behavior, inferred-category confirmation, and the `Cambiar`/`Eliminar` callbacks. PostgreSQL remains the production backend and all new persistence must remain user-scoped. Takenos and remote/secret data are out of scope.

## Current behavior

### Parsing and explicit categories

`src/parseMessage.js` treats the last token as the amount when numeric; otherwise it treats only the final token as a category and the penultimate token as the amount. Thus `coffee 50 food` and `coffee with milk 50` work, but `hotel 50 Travel and Lodging` is parsed as amount `and` and rejected. The parser has no budget context or delimiter.

A backward-compatible first approach is to treat the rightmost numeric token as the amount and all following tokens as the explicit category. This preserves the documented forms and enables multi-word names. Remaining ambiguities should be specified: category names ending in a numeric token cannot be distinguished from an omitted category; localized comma decimals are not currently supported; and arbitrary numbers may occur in descriptions. Quoted names or a delimiter would be less ambiguous but would introduce a new syntax.

### Inference

`src/inferCategory.js`:

- calls OpenRouter once with the configured model (default `google/gemini-2.5-flash`);
- supplies bare category names plus the current description and amount;
- contains only two English semantic distinctions: Housing vs Lodging and Investments vs Shopping;
- asks for JSON but uses `json_object`, not a schema/enum;
- trusts a single numeric confidence value and uses a fixed `0.7` threshold;
- validates the selected category by exact case-insensitive lookup, which usefully prevents invented categories;
- has no timeout, ranked alternatives, language guidance, local history, or calibration.

The description is JSON-encoded as a user message, which reduces accidental prompt blending but does not eliminate prompt injection. Exact allowlist validation is the decisive safety boundary.

### Bot and correction flow

`src/bot.js` reads budgets only for inferred expenses. A high-confidence inference writes the expense once and returns the existing success text, inferred category, daily total, and exact-expense action buttons. Low confidence, malformed output, and provider failure all converge on the same resend rejection.

After creation, `Cambiar` lists every budget as inline buttons. `set-category` decodes exact UUIDs, verifies that the selected budget still appears in the current user's list, and calls `updateExpenseBudget(expenseId, budgetId)`. No inference provenance or correction signal is retained.

The existing correction UI is reusable for choosing among budgets, but it assumes an expense already exists. Reusing its callback directly before creation would require durable pending-expense state; in-memory state would lose choices on restart and is unsuitable for production.

### Repository and schema

The storage facade keeps bot code SQL-free. PostgreSQL resolves `TELEGRAM_OWNER_ID` to one cached internal user ID and scopes repository reads/writes by it. The schema uses UUIDs, `NUMERIC(12,2)`, local `DATE`, soft deletion, and composite `(budget_id, user_id)` ownership foreign keys. RLS is enabled and `anon`/`authenticated` grants are revoked; application-level owner predicates are still necessary because the service connection may bypass RLS.

`updateExpenseBudget` updates only `WHERE id = $1 AND user_id = $3 AND deleted_at IS NULL`; the composite expense-to-budget FK rejects a cross-user target. Learning must not weaken or bypass either protection and should update the expense plus its learning signal transactionally.

## Category evidence from repository code/docs

No production database or secrets were accessed. The repository does not contain a canonical production category catalog. Names evidenced in code/tests are:

- Strong product-specific evidence: `Housing`, `Lodging`, `Investments`, `Shopping` (explicit semantic prompt and regression tests).
- Relevant Spanish evidence: `Inversiones` (Telegram recategorization test).
- Common fixture/documentation evidence, not proof of production use: `Food`, `Transport`, `Travel`, and example `food`.

This uncertainty matters: `/new` allows arbitrary names, and `budgets` stores only `name` and `amount`. A static semantic catalog must therefore match exact known aliases and fall back safely to name-only categories; it must never rename categories or offer a category absent from the current user's budgets.

A useful bilingual semantic catalog can define concise boundaries and representative Spanish/English examples for exact aliases such as Housing/Vivienda/Hogar, Lodging/Alojamiento, Investments/Inversiones, Shopping/Compras, Food/Comida/Alimentación, Transport/Transporte, and Travel/Viajes. Housing vs Lodging and Investments vs Shopping are known required distinctions. Travel vs Lodging and Food vs groceries/restaurants remain product ambiguities. Editable per-user semantics would be more accurate for arbitrary `/new` categories but requires a management UX/API and is not the smallest slice.

## Recommended direction

### 1. Make inference inputs explicit and bilingual

Represent each current budget sent to inference as `{ name, semantics, examples }`, where semantics/examples come from a small versioned bilingual catalog only on an exact normalized alias match. Tell the model that expense text may be Spanish, English, or mixed, that category output must preserve one exact supplied name, and that examples illustrate boundaries rather than keywords.

Ask for a ranked, deduplicated candidate list (at most three) with confidence/reason in the existing single OpenRouter request. Validate structure, finite confidence in `[0,1]`, exact current-budget membership, and uniqueness locally. Continue auto-accepting only the top valid candidate at the existing threshold so the successful bot path remains unchanged. Model-reported confidence is not calibrated; retain `0.7` initially as compatibility, then measure correction/choice rates before changing it.

### 2. Learn locally from manual recategorization

Use a PostgreSQL-only exact-description rule before calling OpenRouter. Normalize description deterministically (trim, collapse whitespace, case-fold, and define Unicode/diacritic behavior), hash it in the application, and map `(user_id, description_fingerprint)` to the manually selected `budget_id`. On `set-category`, transactionally lock/read the exact active user expense, update its category, and upsert the rule to the selected same-user budget. A later manual correction for the same fingerprint replaces the rule.

This learns from every manual Telegram recategorization without inference-provider or Takenos coupling, avoids sending historical descriptions to OpenRouter, and makes repeated merchants immediate and free. It intentionally does not generalize spelling/merchant variants in the first slice.

Suggested table shape:

- `category_inference_rules(user_id, description_fingerprint, budget_id, created_at, updated_at)`;
- primary key `(user_id, description_fingerprint)`;
- composite foreign key `(budget_id, user_id) -> budgets(id, user_id)`;
- RLS enabled and `anon`/`authenticated` privileges revoked consistently with existing tables.

The fingerprint reduces duplicated plaintext but is still vulnerable to dictionary guessing; it is pseudonymization, not anonymization. An HMAC would improve resistance but adds key lifecycle/rotation complexity. Since descriptions already exist in `expenses`, plain normalized text is also defensible for a personal app, but duplication and retention should be deliberate.

### 3. Offer low-confidence choices without premature writes

For the smallest coherent slice, return two or three validated category names plus complete resend examples using the new multi-word syntax. Do not create an expense on low confidence. This changes rejection into actionable choices without pending state, duplicate-write risk, or restart-sensitive sessions; provider errors can retain the current generic rejection.

If one-tap inline choices are required, add a separate durable, expiring pending-expense model and an idempotent consume transaction. Do not put sensitive descriptions/amounts in callback data or use an in-memory map. This is a larger follow-up because candidate membership, expiry, duplicate callback delivery, exact once-only expense creation, and user isolation all need schema and tests.

## Smallest coherent first slice

One PostgreSQL migration plus focused parser/inference/bot/repository changes:

1. Parse a multi-word explicit category as all tokens after the rightmost numeric amount while retaining existing syntax and errors where practical.
2. Add a static bilingual semantic/example catalog for repository-evidenced aliases, with safe name-only fallback for arbitrary budgets.
3. Return and strictly validate up to three ranked candidates in one OpenRouter request; preserve the existing `0.7` auto-accept behavior and exact success response.
4. On low confidence, write nothing and show validated choices as complete resend examples; keep provider-failure behavior unchanged.
5. Add user-scoped exact-description correction rules; consult them before OpenRouter and transactionally upsert them during the existing exact-expense recategorization.
6. Keep Takenos, Notion migration changes, editable category metadata, fuzzy/embedding learning, pending drafts, and Mini App/API work out of this slice.

This should fit the single-PR 3,500-line budget. Durable one-tap pending choices should be split only if product acceptance requires buttons rather than actionable listed choices.

## Test implications

- Parser: preserve both documented forms; multi-word English/Spanish category; numbers in description; define category-ending-number and invalid-amount behavior.
- Inference: bilingual instructions and examples; only present budgets receive semantics; arbitrary names remain allowed; malformed/NaN/out-of-range/duplicate/invented candidates are rejected; one request only.
- Bot: learned rule bypasses OpenRouter; existing explicit and high-confidence writes/replies/buttons remain byte-for-byte where asserted; low confidence performs no write and shows only current valid categories; provider failure retains rejection.
- Correction: exact expense update and rule upsert are one transaction; repeated correction replaces the rule; deleted/missing and cross-user expense/budget attempts fail closed.
- PostgreSQL: every rule lookup/write carries `user_id`; composite FK, RLS, revoked grants, and two-user unit/integration cases prove isolation.
- Storage: add the smallest repository contract needed without direct SQL in `bot.js`; if Notion remains selectable for rollback, define an explicit no-learning fallback rather than silently issuing PostgreSQL calls.

The baseline `npm test` could not fully run in this worktree because dependencies are not installed (`grammy`, `pg`, `dotenv`, and `@notionhq/client` module resolution failures). Thirty-four dependency-free tests passed and eight test files failed at import time; no product failure was established.

## Risks and ambiguities

- **Semantics ownership:** static aliases are fast but cannot define arbitrary `/new` categories; confirm whether editable category descriptions/examples are required now.
- **Meaning of bilingual:** assumed to mean Spanish/English/mixed expense understanding and bilingual semantic examples, while returning the user's exact stored category name—not automatic category translation.
- **Choice UX:** listed resend choices are the smallest safe slice; one-tap buttons require durable pending state.
- **Learning scope:** exact normalized repetition is private and deterministic but weak; fuzzy matching or few-shot history improves recall while increasing false-positive and privacy risk.
- **Confidence:** LLM confidence is self-reported and uncalibrated. Track local outcomes (rule hit, auto inference, low-confidence choice, later correction) before tuning, but avoid storing unnecessary provider reasons/raw responses.
- **Privacy:** OpenRouter already receives the current description, amount, and budget names. Bilingual static examples add no personal history. Never send correction history in the first slice; document provider retention expectations separately.
- **Cost/latency:** ranked candidates should come from the existing single call. Local learned hits reduce both. An added rule lookup costs one PostgreSQL round trip; avoid retries and add a bounded request timeout in design/apply.
- **Parser ambiguity:** rightmost-numeric parsing cannot support category names ending in a number and does not add comma-decimal localization.
- **Rule lifecycle:** budget deletion/renaming behavior and whether deleting an expense should remove its learned rule need explicit decisions; recommendation is rules follow budget FK lifecycle but outlive the source expense.
- **Observability:** useful counters must not log expense descriptions, model payloads, tokens, or API credentials.

## Reusable patterns

- Exact current-budget allowlisting in `selectInferredBudget`.
- Dependency injection in `handleExpenseMessage` and callback handler tests.
- Compact UUID callback encoding for existing expenses.
- Storage facade/repository boundary; no SQL in bot code.
- PostgreSQL owner resolution, parameterized predicates, composite ownership FKs, RLS lockdown, transactions, and opt-in real integration tests.
- Existing exact-expense recategorization is the natural point to capture learning.
