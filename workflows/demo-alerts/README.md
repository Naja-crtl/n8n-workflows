# Demo Alerts: visitor couldn't open a demo, to Supabase + Telegram

Telegram message when a visitor wakes a demo, when it opens, and an alert when it doesn't start. The demo-proxy Cloudflare Worker (in front of the demos on Render's free tier) sends the alert. Separate from [Demo Monitor](../demo-monitor/), which handles the daily check.

## How it works

1. **Demo-proxy alert** (Webhook): receives demo-proxy's POST, protected by a secret header (Header Auth).
2. **Validate & format** (Code): checks the payload and builds the Telegram message. Bad payloads are rejected.
3. **Acknowledge**: replies `202` right away.
4. **Store alert** (Postgres): one row in `ops.demo_alerts`. A retried delivery is ignored. If saving fails, the alerts below still go out.
5. **Telegram alert**: sent with sound, to the monitoring bot. Every message starts with "🚨" and contains "couldn't open the demo", so a phone automation (for example MacroDroid on Android) can turn it into a ringing alarm.

demo-proxy only sends a message after a visitor's request, and nothing when the demo is already awake:

- `waking` (👀): a visitor opened a sleeping demo and it is starting. Once per wake-up, with the visitor's country.
- `opened` (✅): it started for them, with how many seconds it took.
- `refused` (🚨): Render refused to start the demo (`x-render-routing: hibernate-rate-limited` or a Cloudflare challenge).
- `slow` (🚨): the visitor waited 60 seconds and the demo still hadn't started.

Only `refused` and `slow` start with "🚨" (for the phone alarm), at most one of each per demo every 30 minutes. The daily check never triggers any of them.

Example:

```
🚨 StockPOS: a visitor couldn't open the demo
09 Nov, 15:00 (Dubai)

⛔ Render refused to start it (free-tier wake-up limit). The app isn't broken, but visitors can't open it until Render allows it again.

stockpos-demo.naja.live
status 429 · rndr-id ... · cf-ray ...

No more alerts for this demo for 30 minutes.
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Header Auth | Demo-proxy alert | Name `X-Webhook-Secret`, value: a new random secret (`openssl rand -hex 32`). The same value goes into demo-proxy as `N8N_WEBHOOK_SECRET`. |
| Postgres | Store alert | Same Supabase credential as the other workflows. |
| Telegram API | Telegram alert | The monitoring bot used by Demo Monitor. |

## Setup

1. Run [`setup.sql`](setup.sql) in the Supabase **SQL Editor**. It creates `ops.demo_alerts`.
2. Import `workflow.json` into n8n.
3. Create the Header Auth credential, select the Postgres and Telegram credentials, and replace `YOUR_TELEGRAM_CHAT_ID`.
4. Optional: select [Error Alerts](../error-alerts/) under **Settings > Error workflow**.
5. Test with the `curl` example below, then **Publish**.
6. In the demo-proxy Worker, add the variable `N8N_DEMO_ALERT_URL` = `https://<your-n8n-host>/webhook/demo-alerts`, and the secret `N8N_WEBHOOK_SECRET`.

## Payload

```bash
curl -X POST https://<your-n8n-host>/webhook-test/demo-alerts \
  -H 'Content-Type: application/json' -H 'X-Webhook-Secret: <secret>' \
  -d '{"at":"2026-11-09T11:00:00Z","source":"demo-proxy","demo":"StockPOS","host":"stockpos-demo.naja.live","reason":"refused","details":{"status":429,"rndr_id":"r1","cf_ray":"abc-LAX"}}'
```

| Field | Required | Notes |
|---|---|---|
| `at` | yes | ISO 8601 time of the alert. With `demo`, makes retries safe. |
| `demo` | yes | Demo name; letters, numbers, spaces, `.`, `_`, `-`; max 60 chars. |
| `reason` | yes | `waking`, `opened`, `refused` or `slow`. |
| `host` | no | The demo address the visitor opened. |
| `source` | no | Sender label, max 60 chars. |
| `details` | no | `waking`: `country`. `opened`: `wake_s`. `refused`/`slow`: Render's answer (`status`, `rndr_id`, `x_render_routing`, `cf_ray`, `server_timing`, or `error`). Max 4 KB. |

## Useful queries

```sql
-- alerts per demo, last 30 days
select demo, reason, count(*), max(alert_at) as last
from ops.demo_alerts
where alert_at >= now() - interval '30 days'
group by demo, reason
order by last desc;
```
