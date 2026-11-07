# Demo Monitor: Cloudflare Worker results to Supabase + Telegram

Collects the daily results of a Cloudflare Worker that checks demo apps hosted on Render's free tier, keeps a full history in Postgres (Supabase), and sends a Telegram report after every run. It flags slow wake-ups and repeated failures, sends a weekly summary, and alerts you if the Worker didn't report at all.

n8n never pings the demos itself. Free Render services sleep after inactivity and share a monthly hours budget, so the Worker's single daily wake-up stays the only check.

**Version:** v1.1 (smart alerts + weekly summary)

## How it works

**Results** (Webhook trigger)

1. **Worker results**: receives the Worker's POST, protected by a secret header (Header Auth).
2. **Validate & flatten** (Code): checks the payload and turns it into one item per demo. Bad payloads are rejected.
3. **Acknowledge**: replies `202` to the Worker right away.
4. **Store results** (Postgres): one row per demo in `ops.demo_checks`. A retried delivery of the same run is ignored.
5. **Get stats & baselines** (Postgres): for each demo, the 7-day uptime, its usual wake-up time from earlier runs (last 14 days), and how many runs in a row it has failed.
6. **Build report** (Code) and **Telegram report**: one message per run.
   - ✅ up, with wake-up time
   - 🐢 **slow**: woke at least 50% and 20 seconds slower than usual (needs 3 earlier runs as a baseline), or took over 2 minutes
   - ❌ **down**, with the reason and the failure streak once it reaches 2 runs in a row
   - Silent unless a demo is down. Slow wake-ups arrive silently.

**Missed-run check** (second trigger)

1. **Daily 08:30 missed-run check** (Asia/Dubai, 30 minutes after the Worker's 04:00 UTC / 08:00 Dubai run).
2. **Count today's results**: rows received in the last 3 hours.
3. If none arrived, **Telegram missed-run alert**. This catches a broken cron, a wrong secret, or an unpublished workflow.

**Weekly summary** (third trigger)

1. **Monday 08:45 weekly summary** (Asia/Dubai, after that morning's check).
2. **Get weekly stats**: per demo, the last 7 days compared with the 7 days before.
3. **Telegram weekly summary**: overall uptime, each demo's uptime, average and slowest wake-up, and notable changes from last week. Sent silently.

Example daily report:

```
🚨 Demo check: 1 of 4 down
07 Nov, 08:00 (Dubai)

✅ AutoServicePro: woke in 36.0s · 7d 100%
🐢 FuelStationPro: slow, woke in 98.0s (usually 42.0s) · 7d 100%
❌ MarginTracker: DOWN (3 runs in a row) · 7d 57%
     did not wake up before this run's request limit
✅ StockPOS: woke in 41.0s · 7d 100%
```

Example weekly summary:

```
📅 Weekly demo summary
01 Nov to 07 Nov

Overall: 89% (25/28 checks passed)

✅ AutoServicePro: 100% up (7/7)
     wake avg 36.0s, slowest 37.0s
✅ FuelStationPro: 100% up (7/7)
     wake avg 50.0s, slowest 98.0s (+8.0s vs last week)
❌ MarginTracker: 57% up (4/7), was 100%
     wake avg 35.0s, slowest 35.0s
✅ StockPOS: 100% up (7/7), was 86%
     wake avg 36.7s, slowest 41.0s
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Header Auth | Worker results | Name `X-Webhook-Secret`, value: a long random secret (`openssl rand -hex 32`). The same value goes into the Worker as a secret. |
| Postgres | Store results, Get stats & baselines, Count today's results, Get weekly stats | Same Supabase Session pooler credential as the other workflows (SSL Require, Ignore SSL Issues on). |
| Telegram API | Telegram report, Telegram missed-run alert, Telegram weekly summary | A dedicated monitoring bot from @BotFather, separate from the leads bot. Send it `/start` once so it can message you. |

## Setup

1. Run [`setup.sql`](setup.sql) in the Supabase **SQL Editor**. It creates `ops.demo_checks` and the `ops.demo_uptime_30d` view.
2. Generate the shared secret: `openssl rand -hex 32`. Save it in your password manager.
3. Import `workflow.json` into n8n.
4. In **Worker results**, create a **Header Auth** credential: Name `X-Webhook-Secret`, Value: the secret.
5. Select your Postgres credential in the four Postgres nodes.
6. Select the monitoring bot's Telegram credential and replace `YOUR_TELEGRAM_CHAT_ID` in all three Telegram nodes.
7. Optional but recommended: import [Error Alerts](../error-alerts/) and select it under **Settings > Error workflow**, so a failing step is reported instead of failing silently.
8. Test with the `curl` example in [`worker-integration.md`](worker-integration.md).
9. **Publish**, then add the production URL and the secret to the Worker (see [`worker-integration.md`](worker-integration.md)).

## Configuration

| Setting | Where | Default |
|---|---|---|
| Webhook path | Worker results node | `demo-checks` |
| Slow wake-up rule | Build report code (constants at the top) | 50% and 20s slower than usual, or over 2 minutes; needs 3 earlier runs |
| Baseline window | Get stats & baselines query | Last 14 days |
| Uptime window in daily report | Get stats & baselines query | 7 days |
| Missed-run check time | Daily 08:30 missed-run check node | 08:30 Asia/Dubai (Worker runs 04:00 UTC = 08:00 Dubai) |
| Missed-run window | Count today's results query | Last 3 hours |
| Weekly summary time | Monday 08:45 weekly summary node | Monday 08:45 Asia/Dubai |

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

## Changelog

- **v1.1**: slow wake-up detection, failure streaks, Monday weekly summary, error workflow support.
- **v1.0**: Worker results stored in Supabase, Telegram report per run, missed-run alert.

## Ideas for extending it

- Phone call alerts for failures (Telegram voice call via CallMeBot).
- Feed these results into a combined daily report with the other workflows.
- Public read-only status endpoint for a portfolio website.
