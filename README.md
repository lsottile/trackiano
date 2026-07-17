# Trackiano

Telegram bot that logs expenses to Notion.

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
- `/categories` — list all available categories

**Management**
- `/new <name> <amount>` — create a new budget category in Notion
- `/help` — show all available commands

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | ✓ | Telegram bot token |
| `TELEGRAM_OWNER_ID` | ✓ | Your Telegram user ID (only you can use the bot) |
| `NOTION_TOKEN` | ✓ | Notion integration token |
| `NOTION_EXPENSES_DB_ID` | ✓ | Notion expenses database ID |
| `NOTION_BUDGETS_DB_ID` | ✓ | Notion budgets database ID |
| `OPENROUTER_API_KEY` | For inferred categories | OpenRouter API key used when the expense category is omitted |
| `OPENROUTER_MODEL` | — | OpenRouter model for category inference, defaults to `google/gemini-2.5-flash` |
| `PAY_DATE_DAY` | — | Day of month for payday (defaults to last day of month) |

## Setup

```bash
npm install
cp .env.example .env
# fill in the variables
node src/bot.js
```

## Deploy

Deployed on Railway as a standalone service.
