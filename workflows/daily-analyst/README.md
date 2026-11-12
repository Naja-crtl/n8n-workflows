# Daily Analyst: n8n collects the numbers, a self-hosted Hermes Agent writes the report

Every morning n8n gathers the day's numbers from every system (social posts and their results, leads, demo uptime, workflow failures), sends the totals to a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent), and posts the agent's report to Telegram. The report says what needs attention, compares the week with the week before, remembers earlier days, and ends with one concrete idea to improve the business and the single most useful action for today.

n8n does the data work (fixed queries, no AI); the agent only reads the summary and writes. Names, emails and messages never leave n8n: Hermes receives counts and statuses only.

## How it works

1. **Every day 08:50** (Schedule Trigger, Asia/Dubai), after the morning demo check.
2. **Settings** (Code): IDs, the Hermes address, the memory key, and a short description of the business and its goals, so the ideas fit what you are working on.
3. **Leads & demos** (Postgres): new and spam leads in the last 24 hours and 7 days, leads waiting for a reply, the latest check and 7-day uptime per demo, and demo alerts.
4. **Workflow runs (24h)** (Postgres): runs and failures per workflow, read from n8n's own execution log in the same database. Manual test runs are left out.
5. **D1: automatic jobs, posts (14 days), upcoming posts** (HTTP Request to the Cloudflare D1 API): which scheduled job ran last and where (n8n or the Cloudflare Worker standby), what was published or failed, reach and engagement per platform this week and last week, and what is scheduled next.
6. **Build summary** (Code): turns everything into one small JSON of totals, decides whether today needs a loud notification, and builds the request for Hermes. A data source that fails is listed as missing instead of stopping the report.
7. **Ask Hermes** (HTTP Request): sends the summary to Hermes' OpenAI-compatible API with a fixed `X-Hermes-Session-Key`, so its memory of earlier reports stays together, and an `Idempotency-Key`.
8. **Format message** (Code): the report, or the plain numbers if Hermes could not answer, so a report always arrives.
9. **Telegram report**: silent on normal days, with sound when something needs action.

On Mondays the report adds a short weekly review with three improvements: marketing, getting leads, and the demos or automations.

Example:

```
🧠 Daily report · Friday, 13 November 2026

4 demos down, no leads this week
Needs attention: all 4 demos were refused by Render's free-tier wake limit this morning. Visitors tried to open 3 of them in the last 24 hours. 1 lead is waiting for a reply.
Marketing: 1 post went out on Facebook, Instagram and LinkedIn. Instagram reach this week 89, down from 268.
Leads: 0 new in 7 days (1 the week before). Third report in a row without a new lead.
Demos and automations: publishing runs on n8n, the other jobs on the Worker as planned. No workflow failures.
Idea: visitors keep waking the demos; host the two most visited ones on the always-on Oracle server so they open instantly.
Today: reply to the waiting lead.
```

## The agent setup

Hermes runs as a container next to n8n, from the official image `nousresearch/hermes-agent`, with its own data folder:

```yaml
# docker-compose.override.yml, next to the n8n docker-compose.yml
services:
  hermes:
    image: nousresearch/hermes-agent:stable
    restart: unless-stopped
    command: gateway run
    volumes:
      - ./hermes:/opt/data
    # No ports for the API: only containers on this network (n8n) can reach http://hermes:8642.
    ports:
      - "127.0.0.1:9119:9119"   # dashboard: through an SSH tunnel only, with a login
    environment:
      - HERMES_DASHBOARD=1
```

How it is locked down:

- **Not on the internet.** The API has no published port. n8n reaches it over the Docker network; from outside, the port does not exist.
- **Its own key.** `API_SERVER_KEY` in Hermes' `.env`, stored in n8n as a Header Auth credential.
- **No dangerous tools.** The API server may use memory only: `platform_toolsets: api_server: [memory]` in `config.yaml`. No terminal, files, browser or code execution, checked with `GET /v1/toolsets`.
- **Dashboard behind two locks.** A password login (stored as a hash) and a port bound to the server itself, opened with `ssh -L 9119:127.0.0.1:9119`.
- **Memory on.** `memory.memory_enabled` and `memory.user_profile_enabled`, so the agent compares days and remembers your preferences.
- **Free models with automatic fallback.** Main model on Google AI Studio's free tier, with `fallback_providers` to a free Nous Portal model (free plan, signed in with `hermes model`) and then free OpenRouter models. When the main model is busy or rate limited, Hermes switches by itself.
- **Telemetry off.**

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Postgres | Leads & demos, Workflow runs (24h) | Same Supabase credential as the other workflows. n8n's own tables must be in the same database for the workflow runs. |
| Header Auth | the three D1 nodes | Name `Authorization`, value `Bearer <Cloudflare API token>` with D1 read access. |
| Header Auth | Ask Hermes | Name `Authorization`, value `Bearer <Hermes API_SERVER_KEY>`. |
| Telegram API | Telegram report | The monitoring bot. |

## Setup

1. Run Hermes next to n8n (above): `docker run -it --rm -v ~/n8n/hermes:/opt/data nousresearch/hermes-agent:stable setup` for the model, then add `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0` and a random `API_SERVER_KEY` to `hermes/.env`, set `api_server: [memory]` and turn memory on, then `docker compose up -d hermes`.
2. Import `workflow.json` into n8n.
3. In **Settings**, fill in the Cloudflare account ID and D1 database ID, and rewrite `goals` in your own words.
4. Select the credentials above, and replace `YOUR_TELEGRAM_CHAT_ID`.
5. Optional: select [Error Alerts](../error-alerts/) under **Settings > Error workflow**.
6. **Execute workflow** to test, then **Publish**.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Report time | Every day 08:50 node | 08:50 Asia/Dubai |
| Business context and goals | Settings > `goals` | Your own description |
| Memory key | Settings > `session_key` | `daily-analyst` |
| Hermes address | Settings > `hermes_url` | `http://hermes:8642/v1/chat/completions` |
| Wait for the agent | Ask Hermes > Options > Timeout | 10 minutes (falling back to the next model can take a few) |
| Report rules and sections | Build summary > `instructions` | Up to 18 lines, 25 on Mondays |

## Notes

- **Rules go in Settings, preferences in memory.** Facts that must always hold (for example "LinkedIn gives no results for personal posts, ignore the zeros") belong in `goals`, where they are sent every day. Preferences ("keep it shorter") can be taught in the Hermes dashboard chat and are kept in its memory.
- **Free model tiers may use what they receive for training.** That is why only totals are sent. A paid API key removes that concern and the occasional wait for a busy free model.
- **If Hermes is down**, the report still arrives with the plain numbers, and the Telegram message says why.
