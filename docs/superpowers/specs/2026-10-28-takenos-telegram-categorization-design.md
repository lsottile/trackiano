# Takenos Telegram Categorization Design

## Intent

Make Takenos email ingestion visible and independently actionable in Telegram. A burst of emails must never collapse into one categorization action, and successful automatic ingestion must restore the daily accumulated-spend confirmation.

## Approved behavior

- Each Takenos email represents one independent expense.
- Each unknown expense gets its own Telegram category prompt.
- Choosing a category affects only the selected pending expense, even when other pending expenses have the same merchant.
- The selected merchant/category mapping is saved for future expenses only; it does not consume already-pending expenses.
- An existing exact merchant mapping takes precedence and creates the expense without prompting.
- A conservative built-in merchant-family rule runs only when there is no exact mapping:
  - Uber, Cabify, taxi, or DiDi variants → `Transport`
  - PedidosYa or Rappi variants → `Restaurants`
  - coffee, café, cafetería, or Starbucks variants → `Coffee & Snacks`
  - market, supermarket, supermercado, or grocery variants → `Groceries`
  - pharmacy, farmacia, Farmacity, or drugstore variants → `Health`
  - hotel, hostel, or Airbnb variants → `Lodging`
  - Netflix or Spotify variants → `Subscriptions`
- Rules match normalized merchant tokens or explicit brand prefixes, including separators such as spaces, hyphens, and underscores. They must not match arbitrary substrings inside unrelated words.
- A rule is used only when its destination category exists among the current budgets. Otherwise the expense remains pending for manual categorization.
- Every newly created automatic or manually categorized expense sends a Telegram confirmation containing merchant, amount, category, and `Consumo de hoy`.
- Multiple emails processed in order produce one confirmation each with an increasing daily total.
- Duplicate delivery never creates a second expense or Telegram confirmation.
- A Telegram delivery failure is reported coarsely but does not roll back a persisted expense or cause Gmail to retry it as a new expense.

## Architecture

Add a pure merchant-family classifier that resolves against live budget names. Keep exact learned mappings as the first lookup and use the classifier only as a fallback.

Add an idempotent PostgreSQL operation that inserts an ingestion expense and returns the post-insert daily total in one transaction. Both automatic ingestion and pending-expense categorization use this operation so totals and duplicate behavior stay consistent.

Change pending categorization from merchant-wide processing to one pending row per callback. Saving the merchant mapping remains useful for future arrivals, but existing pending rows remain independent.

Telegram confirmation formatting and action buttons are shared between automatic and manually categorized ingestion. Notification failures remain best-effort after persistence.

## Constraints

- ES modules only; no new runtime dependencies.
- All database access remains in `src/postgres.js` through `src/storage.js`.
- Existing owner scoping, ingest-ID deduplication, and Gmail accepted-message semantics remain intact.
- No schema migration is required.
