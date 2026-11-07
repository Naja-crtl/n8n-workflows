# Error Alerts: any workflow failure to Telegram

A small shared workflow that sends a Telegram alert whenever another workflow fails: which workflow, which step, the error message, and a link to the failed execution. Without it, a failing step (for example, the database being unreachable) only shows up in n8n's execution list, and nobody notices.

One Error Alerts workflow covers all your workflows. Each workflow just points to it in its settings.

## How it works

1. **On workflow error** (Error Trigger): n8n starts this workflow automatically when a workflow that uses it as its error workflow fails.
2. **Format alert** (Code): builds a short message. It handles both a failed execution and a trigger that failed before running.
3. **Telegram error alert**: sends it with a normal notification.

Example:

```
🛠 Workflow failed: Demo Monitor
07 Nov, 08:00 (Dubai) · webhook

Step: Store results
Error: connection timeout

Open the execution
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Telegram API | Telegram error alert | Reuse the monitoring bot. Send it `/start` once so it can message you. |

## Setup

1. Import `workflow.json` into n8n.
2. In **Telegram error alert**, select the Telegram credential and replace `YOUR_TELEGRAM_CHAT_ID` with your chat ID.
3. **Save** it. It doesn't need to be published: n8n runs error workflows automatically.
4. In each workflow you want covered: open **Settings** (the ⋯ menu > Settings), set **Error workflow** to **Error Alerts**, and save.

## Notes

- Error workflows only run for automatic (production) executions: published webhooks and schedules. Manual test runs in the editor don't trigger them.
- A rejected webhook request (wrong secret, `403`) never starts an execution, so it doesn't trigger an alert. An invalid payload that passes authentication does.
- If this workflow itself fails, for example because Telegram is unreachable, n8n can't report it. An external watchdog for the n8n server covers that case.
