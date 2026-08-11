# Trackiano

Telegram bot that logs expenses through a selectable Notion or PostgreSQL storage backend.

## Usage

Send a message with the format:
```
{description} {amount}
{description} {amount} {category}
```
Examples: `coffee 50`, `coffee 50 food`

When the category is omitted, the bot infers it with OpenRouter using only the
allowed category names from Notion plus the expense description and amount. If it
cannot infer a safe match, it asks you to resend the expense with an explicit
category.

## Commands

**Queries**
- `/budget <category>` — daily allowance based on remaining balance and days until payday
- `/budget <category> detail` — list all expenses for the current pay period
- `/balance <category>` — remaining balance for a category
- `/summary` — monthly expenses by category
- `/summary-complete` — monthly summary with the two largest expenses in each category
- `/target` — show the recurring global daily spending target
- `/target <amount>` — set a positive recurring global daily spending target
- `/categories` — list all available categories

**Management**
- `/new <name> <amount>` — create a new budget category
- `/help` — show all available commands

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | ✓ | Telegram bot token |
| `TELEGRAM_OWNER_ID` | ✓ | Your Telegram user ID (only you can use the bot) |
| `STORAGE_BACKEND` | — | `notion` (safe pre-cutover default) or `postgres` |
| `DATABASE_URL` | PostgreSQL | PostgreSQL connection string |
| `PGSSLMODE` | PostgreSQL | `require` with a trusted root, or `disable` only for disposable local/test databases |
| `PGSSLROOTCERT` | TLS mode `require` | Trusted CA path; Supabase uses `certs/supabase-root-2021.crt` |
| `NOTION_TOKEN` | Notion/migration | Notion integration token |
| `NOTION_EXPENSES_DB_ID` | ✓ | Notion expenses database ID |
| `NOTION_BUDGETS_DB_ID` | ✓ | Notion budgets database ID |
| `NOTION_SETTINGS_DB_ID` | ✓ | Dedicated Notion settings database ID |
| `OPENROUTER_API_KEY` | For inferred categories | OpenRouter API key used when the expense category is omitted |
| `OPENROUTER_MODEL` | — | OpenRouter model for category inference, defaults to `google/gemini-2.5-flash` |
| `APP_LANGUAGE` | — | User language stored during migration, defaults to `es` |
| `APP_CURRENCY` | — | ISO currency stored during migration, defaults to `USD` |
| `APP_TIMEZONE` | — | Timezone used for expense dates and daily totals, defaults to `UTC` |
| `PAY_DATE_DAY` | — | Day of month for payday (defaults to last day of month) |

## Setup

```bash
npm install
cp .env.example .env
# fill in the variables
node src/bot.js
```

## Deploy

The long-running bot and automatic summaries use separate Railway services:

- Bot service: run `npm start` continuously.
- Notification service: run `npm run notifications` as a Railway cron service.
- Schedule the notification service periodically in UTC; every 15 minutes is recommended. The command checks calendar periods in `APP_TIMEZONE` and exits after each run.

Create an empty dedicated settings database manually in Notion and share it with
the existing integration. Add these properties, but do not create the singleton
row yourself:

| Property | Type |
|----------|------|
| `Name` | Title |
| `Daily target` | Number |
| `Attempted weekly period` | Text |
| `Attempted monthly period` | Text |

Do not use the budgets database for settings. Trackiano creates and initializes
the singleton with the latest already-closed weekly and monthly periods claimed,
preventing retroactive notifications. If a singleton row already exists with one
or both attempted-period values blank, Trackiano safely initializes only the
blank values without changing the daily target or an existing claim. `/target 70`
then means `$70` per day until changed.

Weekly notifications cover the previous closed Monday-Sunday and compare total
spend with `7 × Daily target`. Monthly notifications cover the previous closed
calendar month and compare total spend with `days in month × Daily target`. If
Monday is also the first day of a month, both summaries are processed
independently.

Delivery uses a durable claim before calling Telegram. This provides an
at-most-once tradeoff: repeated runs and restarts do not resend a claimed period,
but a Telegram failure or process crash after the claim leaves the notification
unsent and it will not be retried. Exactly-once delivery is impossible across
Notion and Telegram without a shared transaction. Run exactly one Railway cron
service, keep executions non-overlapping, and do not run notifications manually
while the cron can be active. Notion claims are not transactional across processes, so concurrent Notion-backed
runs can race and send duplicates. PostgreSQL claims use one conditional atomic update,
so only one concurrent worker can claim a given user and period.

Railway and Notion setup is intentionally manual and must be performed only with
explicit approval; normal tests do not mutate either remote environment.

## PostgreSQL migration

PostgreSQL support is multi-user-ready but the current bot still binds every operation
to `TELEGRAM_OWNER_ID`. Takenos is intentionally not part of this schema or migration.
Money uses `NUMERIC(12,2)`, expense dates remain local calendar dates, and deleted
expenses are retained with a soft-delete timestamp.

Apply versioned schema migrations only after configuring a local or approved database:

```bash
DATABASE_URL=postgres://... PGSSLMODE=require \
PGSSLROOTCERT=certs/supabase-root-2021.crt npm run db:migrate
```

The Notion migration reads every paginated budget, expense, and settings row,
preserves UUIDs, validates relationships, and reconciles every field plus concise totals.
It is a dry-run unless `--apply` is explicitly supplied:

```bash
npm run migrate:notion
npm run migrate:notion -- --apply
```

Recommended cutover:

1. Restore read access to all three Notion databases.
2. Pause the bot and notification worker so no expense can be written mid-migration.
3. Run PostgreSQL schema migrations, then the Notion dry-run.
4. Correct every validation error before using `--apply`.
5. Require a matching reconciliation report before setting `STORAGE_BACKEND=postgres`.
6. Restart one bot and one notification worker and observe them before resuming normal use.

Rollback is immediate only before PostgreSQL is reopened for user writes. After any
expense has been accepted by PostgreSQL, first pause both services and reconcile or
manually export those PostgreSQL-only changes; switching directly to unchanged Notion
would hide them. Do not accept writes in both backends: this migration intentionally
does not dual-write. Keep Notion unchanged during the initial observation window.

The importer refuses to overwrite a non-empty divergent PostgreSQL target. An identical
retry is a no-op; changed source or target data requires explicit operator resolution.
