# Demo Monitor: Cloudflare Worker results to Supabase + Telegram

Collects the daily results of a Cloudflare Worker that checks demo apps hosted on Render's free tier, keeps a full history in Postgres (Supabase), and sends a Telegram report after every run. A second check alerts you if the Worker didn't report at all.

n8n never pings the demos itself. Free Render services sleep after inactivity and share a monthly hours budget, so the Worker's single daily wake-up stays the only check.

## How it works

**Results** (Webhook trigger)

1. **Worker results**: receives the Worker's POST, protected by a secret header (Header Auth).
2. **Validate & flatten** (Code): checks the payload and turns it into one item per demo. Bad payloads are rejected.
3. **Acknowledge**: replies `202` to the Worker right away.
4. **Store results** (Postgres): one row per demo in `ops.demo_checks`. A retried delivery of the same run is ignored.
5. **Get 7-day stats** (Postgres): uptime percentage per demo for the last 7 days.
6. **Build report** (Code) and **Telegram report**: one message per run. Silent when everything is up, a normal notification when any demo is down.

**Missed-run check** (second trigger)

1. **Daily 08:30 missed-run check** (Asia/Dubai, 30 minutes after the Worker's 04:00 UTC / 08:00 Dubai run).
2. **Count today's results**: rows received in the last 3 hours.
3. If none arrived, **Telegram missed-run alert**. This catches a broken cron, a wrong secret, or an unpublished workflow.

Example report:

```
🚨 Demo check: 1 of 3 down
07 Nov, 08:00 (Dubai)

✅ AutoServicePro: woke in 23.9s
❌ MarginTracker: DOWN · 7d 86%
     Health check timed out after 180s
✅ StockPOS: woke in 41.2s · 7d 100%
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Header Auth | Worker results | Name `X-Webhook-Secret`, value: a long random secret (`openssl rand -hex 32`). The same value goes into the Worker as a secret. |
| Postgres | Store results, Get 7-day stats, Count today's results | Same Supabase Session pooler credential as the other workflows (SSL Require, Ignore SSL Issues on). |
| Telegram API | Telegram report, Telegram missed-run alert | A dedicated monitoring bot from @BotFather, separate from the leads bot. Send it `/start` once so it can message you. |

## Setup

1. Run [`setup.sql`](setup.sql) in the Supabase **SQL Editor**. It creates `ops.demo_checks` and the `ops.demo_uptime_30d` view.
2. Generate the shared secret: `openssl rand -hex 32`. Save it in your password manager.
3. Import `workflow.json` into n8n.
4. In **Worker results**, create a **Header Auth** credential: Name `X-Webhook-Secret`, Value: the secret.
5. Select your Postgres credential in the three Postgres nodes.
6. Select the monitoring bot's Telegram credential and replace `YOUR_TELEGRAM_CHAT_ID` in both Telegram nodes.
7. Test with the `curl` example in [`worker-integration.md`](worker-integration.md), using the test URL while the workflow is listening.
8. **Publish**, then add the production URL and the secret to the Worker (see [`worker-integration.md`](worker-integration.md)).

## Configuration

| Setting | Where | Default |
|---|---|---|
| Webhook path | Worker results node | `demo-checks` |
| Missed-run check time | Daily 08:30 missed-run check node | 08:30 Asia/Dubai (Worker runs 04:00 UTC = 08:00 Dubai) |
| Missed-run window | Count today's results query | Last 3 hours |
| Uptime window in report | Get 7-day stats query | 7 days |

## Useful queries

```sql
-- 30-day uptime and wake-up time per demo
select * from ops.demo_uptime_30d;

-- recent failures with reasons
select run_at, demo, status_code, problem
from ops.demo_checks
where not ok
order by run_at desc
limit 20;

-- wake-up time trend for one demo
select date_trunc('day', run_at) as day, wake_ms
from ops.demo_checks
where demo = 'StockPOS'
order by day;
```

## Ideas for extending it

- Weekly uptime summary in the Monday report.
- Alert when a demo's wake-up time is much slower than its usual average.
- Feed these results into a combined morning business report.
