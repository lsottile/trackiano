# Takenos Telegram Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process every Takenos email independently in Telegram, apply only conservative known classification rules, and restore per-expense daily accumulated-spend confirmations.

**Architecture:** A pure merchant-family classifier resolves high-confidence merchant patterns against live budgets after exact learned mappings miss. A new idempotent PostgreSQL transaction returns the daily total for newly ingested expenses, while Telegram handlers process one pending row at a time and share confirmation formatting with automatic ingestion.

**Tech Stack:** Node.js 22, ES modules, `node:test`, PostgreSQL via `pg`, grammy, Google Apps Script test harness.

**Spec:** `docs/superpowers/specs/2026-10-28-takenos-telegram-categorization-design.md`

## Global Constraints

- ES modules only; no new runtime dependencies.
- All database access goes through `src/postgres.js` and `src/storage.js`.
- Exact active merchant mappings take precedence over built-in family rules.
- Built-in rules resolve only to live budget names and never use arbitrary substring matches.
- One Gmail message ID maps to one idempotent expense and at most one Telegram confirmation.
- Telegram delivery failures must not roll back persisted expenses.

## Review Focus

- Merchant words embedded inside unrelated words (for example `MARKETING`) must not match `market`; Task 1 adds boundary tests.
- An exact learned mapping that disagrees with an obvious rule must win; Task 4 adds orchestration coverage.
- A rule whose destination budget is absent must fall back to an independent pending prompt; Task 1 and Task 4 cover this.
- A duplicate Gmail delivery must not emit another confirmation; Task 4 covers created-versus-duplicate behavior.
- A Telegram API failure after persistence must still return an accepted ingestion response and avoid retry-created duplicates; Task 4 covers failure isolation.

---

### Task 1: Conservative merchant-family classification

**Files:**
- Create: `src/merchantCategoryRules.js`
- Create: `test/merchantCategoryRules.test.js`

**Interfaces:**
- Consumes: normalized merchant text from `normalizeMerchant(merchant)` and live budgets shaped as `{ id, name }`.
- Produces: `findMerchantFamilyBudget(merchant, budgets) -> budget | null`.

- [ ] **Step 1: Write failing classifier tests**

Test that `findMerchantFamilyBudget` maps approved variants such as `UBER-PAY`, `PEDIDOSYA*FOOD`, `COFFEE_SHOP`, `SUPER-MARKET 24`, `FARMACIA CENTRAL`, `AIRBNB`, and `SPOTIFY` to their exact live budgets. Assert that accents and separators normalize, `MARKETING` does not match `market`, an absent destination budget returns `null`, and ambiguous/unlisted merchants return `null`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/merchantCategoryRules.test.js`

Expected: FAIL because `src/merchantCategoryRules.js` does not exist.

- [ ] **Step 3: Implement the pure classifier**

Create `findMerchantFamilyBudget(merchant, budgets)` with a frozen ordered rule table. Normalize NFKD accents, case, and non-alphanumeric separators into tokens; use whole-token checks plus explicit joined brand prefixes (`PEDIDOSYA`, `FARMACITY`, `STARBUCKS`, `AIRBNB`, `NETFLIX`, `SPOTIFY`) rather than free substrings. Resolve destinations by case-insensitive exact budget name.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/merchantCategoryRules.test.js`

Expected: all classifier tests PASS with no warnings.

- [ ] **Step 5: Commit the work unit**

```bash
git add src/merchantCategoryRules.js test/merchantCategoryRules.test.js
git commit -m "feat(ingest): classify obvious merchant families"
```

### Task 2: Idempotent ingestion write with daily total

**Files:**
- Modify: `src/postgres.js:577-602`
- Modify: `src/storage.js:3-84`
- Modify: `test/postgres.test.js:616-674`
- Modify: `test/storage.test.js`

**Interfaces:**
- Consumes: `createIngestedExpenseAndGetTotalToday(expense)` with the existing ingestion expense shape, including `ingestId` and optional `now`.
- Produces: `{ created: boolean, expenseId: string | null, totalToday: number | null }`.

- [ ] **Step 1: Write failing repository and facade tests**

Add a repository test asserting that a new ingest ID is inserted inside a transaction, the owner-scoped total for the expense date is queried after insertion, and the method returns `{ created: true, expenseId, totalToday: 30.27 }`. Add a duplicate test asserting `ON CONFLICT` returns `{ created: false, expenseId: null, totalToday: null }` without querying the total. Add storage parity coverage for the new method.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/postgres.test.js test/storage.test.js`

Expected: FAIL because `createIngestedExpenseAndGetTotalToday` is missing.

- [ ] **Step 3: Implement the transactional repository method**

Add `createIngestedExpenseAndGetTotalToday(expense)` to `src/postgres.js`. Resolve the owner once, insert with the existing partial ingest-ID conflict target, return early for duplicates, then call `totalTodayWith(transaction, userId, now)` after insertion. Expose the exact method through `STORAGE_METHODS` and a named wrapper in `src/storage.js`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/postgres.test.js test/storage.test.js`

Expected: all repository and facade tests PASS.

- [ ] **Step 5: Commit the work unit**

```bash
git add src/postgres.js src/storage.js test/postgres.test.js test/storage.test.js
git commit -m "feat(ingest): return daily total for deduped expenses"
```

### Task 3: Independent pending-expense categorization

**Files:**
- Modify: `src/bot.js:133-253`
- Modify: `test/bot.test.js:544-672`

**Interfaces:**
- Consumes: one pending row from `getPendingIngestion(id)` and `createIngestedExpenseAndGetTotalToday(expense)` from Task 2.
- Produces: `processPendingExpense(pending, budget, dependencies)` and shared `formatIngestedExpenseConfirmation(...)`; only the selected pending ID is marked processed.

- [ ] **Step 1: Write failing independent-processing tests**

Replace merchant-wide expectations with tests showing two pending rows for the same merchant remain independent: selecting the first writes and marks only the first, saves the mapping for future arrivals, and leaves the second untouched. Assert the callback reply includes description, amount, selected category, `Consumo de hoy`, and expense action buttons. Add duplicate and write-failure cases that never mark a failed row processed.

- [ ] **Step 2: Run the focused bot tests and verify RED**

Run: `node --test --test-name-pattern="pending|merchant" test/bot.test.js`

Expected: FAIL because the current handler processes all pending rows by merchant and lacks a daily total.

- [ ] **Step 3: Implement one-row pending processing and shared confirmation formatting**

Replace `processPendingMerchant` with `processPendingExpense(pending, budget, dependencies)`. Save the exact mapping, call Task 2's write using `pending.createdAt`, mark only `pending.id` after a successful create-or-duplicate result, and return the write result. Format successful creates as merchant, amount, category, and `Consumo de hoy`, with the existing expense action keyboard.

- [ ] **Step 4: Run the focused bot tests and verify GREEN**

Run: `node --test --test-name-pattern="pending|merchant" test/bot.test.js`

Expected: all matching bot tests PASS.

- [ ] **Step 5: Commit the work unit**

```bash
git add src/bot.js test/bot.test.js
git commit -m "fix(ingest): categorize pending expenses independently"
```

### Task 4: Automatic rules, one confirmation per email, and failure isolation

**Files:**
- Modify: `src/ingest.js:3-218`
- Modify: `src/bot.js:154-180`
- Modify: `test/ingest.test.js:94-369`
- Modify: `test/bot.test.js:544-570`
- Modify: `test/takenosGmailForwarder.test.js:8-153`

**Interfaces:**
- Consumes: `findMerchantFamilyBudget` from Task 1, `createIngestedExpenseAndGetTotalToday` from Task 2, and `createIngestedExpenseNotifier({ ownerId, sendMessage })` from `src/bot.js`.
- Produces: mapped/rule-based ingestion that emits exactly one best-effort confirmation for every newly created expense; unknown ingestion still creates one pending row and prompt per email.

- [ ] **Step 1: Characterize Apps Script batch forwarding**

Extend the Apps Script harness to return multiple message IDs and assert every accepted message is forwarded and trashed independently.

Run: `node --test --test-name-pattern="multiple" test/takenosGmailForwarder.test.js`

Expected: PASS, proving Gmail fan-out already works and the missing behavior is in Telegram ingestion.

- [ ] **Step 2: Write failing ingestion tests**

Add tests for: exact mapping winning over an Uber rule; rule-based `UBER-PAY` creation without a prompt; missing destination budget falling back to a pending prompt; two unknown email IDs producing two distinct prompts; two known email IDs producing two confirmations with increasing totals; duplicate redelivery producing no confirmation; and notifier rejection still returning the persisted status.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test test/ingest.test.js test/bot.test.js test/takenosGmailForwarder.test.js`

Expected: FAIL on rule fallback, confirmation, and independent pending assertions.

- [ ] **Step 4: Implement ingestion orchestration and notifier**

Have `ingestPurchase` load live budgets only after exact mapping misses or when a category name is needed, apply Task 1 rules as the fallback, and call Task 2's write. On `created: true`, invoke `notifyExpenseCreated` with expense ID, description, amount, budget name, and total; catch notification errors, report only `ingested_expense_notification`, and preserve the successful ingestion response. Build the production notifier with grammy `Api` and the shared confirmation/action-keyboard formatting. Keep duplicate and pending response codes unchanged.

- [ ] **Step 5: Run focused tests and the complete suite**

Run: `node --test test/ingest.test.js test/bot.test.js test/takenosGmailForwarder.test.js`

Expected: focused tests PASS.

Run: `npm test`

Expected: the complete suite passes, with only the existing opt-in PostgreSQL integration test skipped.

- [ ] **Step 6: Commit the work unit**

```bash
git add src/ingest.js src/bot.js test/ingest.test.js test/bot.test.js test/takenosGmailForwarder.test.js
git commit -m "fix(ingest): confirm every Takenos expense in Telegram"
```

### Task 5: Operational documentation and final verification

**Files:**
- Modify: `integrations/gmail/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: final behavior from Tasks 1-4.
- Produces: operator-facing explanation of independent prompts, automatic families, daily totals, and duplicate behavior.

- [ ] **Step 1: Update documentation**

Document that every accepted email is processed independently; exact mappings and conservative family rules skip prompting; unknown expenses each receive their own prompt; and every newly created expense reports the accumulated daily total in Telegram.

- [ ] **Step 2: Run final verification**

Run: `npm test`

Expected: all unit tests PASS and only the existing real-PostgreSQL test is skipped.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Record runtime boundary and rollback**

Runtime boundary: use the Apps Script VM harness plus the HTTP ingestion server tests; no production deployment or live Gmail mutation occurs in this worktree. Rollback boundary: revert the five work-unit commits to restore merchant-wide pending processing and silent automatic ingestion without affecting unrelated expense flows.

- [ ] **Step 4: Commit the work unit**

```bash
git add README.md integrations/gmail/README.md docs/superpowers/specs/2026-10-28-takenos-telegram-categorization-design.md docs/superpowers/plans/2026-10-28-takenos-telegram-categorization.md
git commit -m "docs(ingest): describe Telegram categorization flow"
```
