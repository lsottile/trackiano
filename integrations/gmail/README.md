# Connect Gmail to Trackiano

This one-time setup forwards new Takenos purchase emails to Trackiano every five minutes. It ignores older messages, processes every matching email independently, moves accepted messages to Gmail Trash, and leaves rejected messages in place for retry or inspection.

## Before you start

You need:

- the public URL of the Trackiano ingestion service;
- the same `INGEST_TOKEN` configured in that service;
- the exact sender address from a genuine Takenos purchase email;
- `TAKENOS_EMAIL_SENDER` in Railway set to that exact address.

## Install

1. Open [script.google.com](https://script.google.com) with the Gmail account that receives Takenos emails and create a project.
2. Replace `Code.gs` with [`Code.gs`](./Code.gs).
3. In **Project Settings**, enable **Show `appsscript.json` manifest file in editor** and replace its contents with [`appsscript.json`](./appsscript.json).
4. In **Project Settings → Script Properties**, add:

   | Property | Value |
   |----------|-------|
   | `TRACKIANO_INGEST_URL` | Public ingestion-service URL without the endpoint path |
   | `TRACKIANO_INGEST_TOKEN` | Same secret as Railway's `INGEST_TOKEN` |
   | `TAKENOS_EMAIL_SENDER` | Exact Takenos sender address |

5. In the editor, select `setupTakenosEmailForwarder` and click **Run** once.
6. Accept Google's requested Gmail, external-request, and trigger permissions.

The setup records its activation time before creating the trigger, so it does not import historical mail. Do not add `TRACKIANO_STARTED_AT` manually.

## Verify

After the next Takenos purchase email arrives:

1. Wait up to five minutes.
2. Confirm Gmail moved the message to Trash.
3. Confirm Trackiano sent a Telegram expense confirmation with `Consumo de hoy`, or a dedicated category prompt when neither an exact mapping nor a conservative merchant-family rule applies.

When several emails arrive before one trigger run, each accepted email gets its own expense or pending prompt. Categorizing one pending expense does not consume other pending emails from the same merchant; the selected mapping applies only to future arrivals.

If the message remains in the inbox, open **Apps Script → Executions**. Trackiano deliberately leaves rejected messages in place so they can be retried after fixing the sender, endpoint, token, or email format.
