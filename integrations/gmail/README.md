# Connect Gmail to Trackiano

This one-time setup forwards new Takenos purchase emails to Trackiano every five minutes. It ignores older messages, labels accepted messages `trackiano-ingested`, and leaves rejected messages unlabelled for retry or inspection.

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
2. Confirm Gmail applied the `trackiano-ingested` label to that message.
3. Confirm Trackiano created the expense or sent the existing Telegram category prompt.

If the label is absent, open **Apps Script → Executions**. Trackiano deliberately leaves rejected messages unlabelled so they can be retried after fixing the sender, endpoint, token, or email format.
