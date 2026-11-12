# Demo Monitor: Cloudflare Worker results to Supabase + Telegram

Collects the daily results of a Cloudflare Worker that checks demo apps hosted on Render's free tier, keeps a full history in Postgres (Supabase), and sends a Telegram report after every run. It shows which demos were already awake or had to be woken, flags slow pages, Render wake-up refusals and repeated failures, sends a weekly summary, and alerts you if the Worker didn't report at all.

n8n never pings the demos itself. Free Render services sleep after inactivity and share a monthly hours budget, so the Worker's single daily wake-up stays the only check.

**Version:** v1.3 (the check runs from n8n; the Worker is the standby)

**v1.3: the check runs here.** Render wakes a sleeping free service for a request from a normal address, like a visitor's browser, but refuses one from Cloudflare's shared addresses. A check running in a Cloudflare Worker was therefore refused every morning while the demos were fine. Now the **Daily 07:50 demo check** in this workflow wakes each demo through its Render address directly (and measures how long it took), times the start page, checks the public address through the demo-proxy, and feeds the results into the same path as the Worker's webhook. It also records the run in the Worker's D1 database, so the Worker's own 08:00 check stands by and only runs if this one didn't.

## How it works

**Results** (Webhook trigger)

1. **Worker results**: receives the Worker's POST, protected by a secret header (Header Auth).
2. **Validate & flatten** (Code): checks the payload and turns it into one item per demo. Bad payloads are rejected.
3. **Acknowledge**: replies `202` to the Worker right away.
4. **Store results** (Postgres): one row per demo in `ops.demo_checks`. A retried delivery of the same run is ignored.
5. **Get stats & baselines** (Postgres): for each demo, the 7-day uptime, its usual start-page load time from earlier runs (last 14 days), and how many runs in a row it has failed.
6. **Build report** (Code) and **Telegram report**: one message per run.
   - ✅ up: **already awake** or **woke up**, with the start page load time
   - 🐢 **slow page**: at least twice as slow and 2 seconds slower than usual (needs 3 earlier runs as a baseline), or over 10 seconds
   - ⛔ **Render refused to wake it**: Render's free-tier wake-up limit, not a broken app (visitors still can't open it)
   - ❌ **down**: any other failure, with a shortened reason (full details stay in `ops.demo_checks`)
   - Failure streaks are shown once a demo has failed 2 runs in a row
   - Silent unless a demo is down or refused. Slow pages arrive silently.

**Missed-run check** (second trigger)

1. **Daily 08:30 missed-run check** (Asia/Dubai, 30 minutes after the Worker's 04:00 UTC / 08:00 Dubai run).
2. **Count today's results**: rows received in the last 3 hours.
3. If none arrived, **Telegram missed-run alert**. This catches a broken cron, a wrong secret, or an unpublished workflow.

**Weekly summary** (third trigger)

1. **Monday 08:45 weekly summary** (Asia/Dubai, after that morning's check).
2. **Get weekly stats**: per demo, the last 7 days compared with the 7 days before.
3. **Telegram weekly summary**: overall uptime, each demo's uptime, how often it was woken or refused by Render, average and slowest page load, and notable changes from last week. Sent silently.

Example daily report:

```
🚨 Demo check: 2 of 4 down
09 Nov, 08:00 (Dubai)

✅ AutoServicePro: already awake, page 0.8s · 7d 100%
🐢 FuelStationPro: woke up, slow page 7.4s (usually 0.9s) · 7d 100%
❌ MarginTracker: DOWN · 7d 86%
     did not wake up within 5 minutes (health check answered 502, ...)
⛔ StockPOS: Render refused to wake it (2 runs in a row) · 7d 71%

⛔ = Render's wake-up limit. The app isn't broken, but visitors can't open it
until Render allows it to start again. Full details are in ops.demo_checks.
```

Example weekly summary:

```
📅 Weekly demo summary
03 Nov to 09 Nov

Overall: 89% (25/28 checks passed)
⛔ 2 failed checks were Render refusing to wake a demo

✅ AutoServicePro: 100% up (7/7)
     page avg 0.8s, slowest 0.9s
✅ FuelStationPro: 100% up (7/7)
     woken 1× · page avg 1.8s, slowest 7.4s
🟡 MarginTracker: 86% up (6/7), was 100%
     woken 1× · page avg 1.0s, slowest 1.0s
❌ StockPOS: 71% up (5/7), was 100%
     2× refused by Render · page avg 0.7s, slowest 0.7s
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Header Auth | Worker results | Name `X-Webhook-Secret`, value: a long random secret (`openssl rand -hex 32`). The same value goes into the Worker as a secret. |
| Postgres | Store results, Get stats & baselines, Count today's results, Get weekly stats | Same Supabase Session pooler credential as the other workflows (SSL Require, Ignore SSL Issues on). |
| Telegram API | Telegram report, Telegram missed-run alert, Telegram weekly summary | A dedicated monitoring bot from @BotFather, separate from the leads bot. Send it `/start` once so it can message you. |

## Setup

1. Run [`setup.sql`](setup.sql) in the Supabase **SQL Editor**. It creates `ops.demo_checks` and the `ops.demo_uptime_30d` view. Upgrading from v1.0 or v1.1, run just this line: `alter table ops.demo_checks add column if not exists was_asleep boolean;`
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
| Slow page rule | Build report code (constants at the top) | 2× and 2s slower than usual, or over 10 seconds; needs 3 earlier runs |
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

-- page load and wake-up history for one demo
select date_trunc('day', run_at) as day, was_asleep, page_ms, ok
from ops.demo_checks
where demo = 'StockPOS'
order by day;
```

## Changelog

- **v1.3**: the daily check runs from n8n (07:50 Dubai): one wake request per demo to its Render address, wake time measured, start page timed (redirects kept on the Render address), public address checked. The run is recorded in D1 so the Worker's check stands by. The Worker's webhook stays as its fallback.

- **v1.2**: follows the Worker's new check (one wake request, a 5-minute wait only if asleep, no polling): shows already awake vs woke up, slow-page warning based on page load time, Render wake-up refusals as their own status, shorter failure reasons; new `was_asleep` column.
- **v1.1.1**: removed leftover v1.0 nodes.
- **v1.1**: slow wake-up detection, failure streaks, Monday weekly summary, error workflow support.
- **v1.0**: Worker results stored in Supabase, Telegram report per run, missed-run alert.

## Ideas for extending it

- Phone call alerts for failures (Telegram voice call via CallMeBot).
- Feed these results into a combined daily report with the other workflows.
- Public read-only status endpoint for a portfolio website.
