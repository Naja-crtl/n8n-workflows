# NB Assistant

Ask about the business in plain language from Slack: `/ask how many quote requests this week?`, `/ask which demo was down?`, `/ask did any workflow fail?` A Python service lets an LLM (free OpenRouter models, with fallback) call the dashboard's read-only queries as tools (overview, leads, marketing, demos, workflows, intakes), runs the calls it asks for, and returns an answer written from the real numbers.

## How it works

1. **Trigger**: the Slack slash command `/ask` posts to the webhook.
2. **Verify**: Slack's signature and timestamp are checked before anything runs; the form fields are parsed.
3. **Acknowledge**: Slack gets "Looking it up…" within its 3-second limit (only the person asking sees it).
4. **Ask**: n8n sends the question to `POST /api/ask` on the dashboards API (FastAPI, on the VPS). There, a tool-calling loop:
   - sends the model the question and 12 tool definitions (name, description, JSON schema for `days` or `limit`),
   - runs every tool the model calls (the same SQL and Cloudflare D1 queries the dashboard uses) and returns the results,
   - repeats until the model answers in text, at most 5 rounds,
   - returns the answer, which tools it used and which model answered.

   Models are tried in order (`nvidia/nemotron-3-ultra-550b-a55b:free`, then `google/gemma-4-31b-it:free`): a busy or rate-limited one gets one retry, then the next answers. `ASK_MODELS` in the env file changes the list without code. The first version used Gemini's free tier, which answered "high demand" (503) too often to rely on.
5. **Reply**: the answer is posted to the channel through Slack's `response_url`, with the tools it looked at and the model.

## Data protection

The tools return what the dashboard shows: totals, company names, statuses. The database role behind them can't read names, emails, phones or messages, so no contact details reach the model, which matters on free tiers that may learn from what they receive.

## Setup

1. Dashboards API: `OPENROUTER_API_KEY` in its env file; `ask.py` next to `main.py`.
2. Slack app (the same one as the Intake Agent): add the slash command `/ask` with request URL `https://<n8n host>/webhook/leads-ask` and the `commands` scope (see `../intake-agent/slack-app-manifest.json`), then reinstall the app.
3. Import `workflow.json`, set **Error workflow** to Error Alerts, publish.

`workflow.json` is generated: edit `build.mjs`, then run `node build.mjs`.

## Cost per question

One question is usually 2 model calls (pick the tools, then answer), about 3,000 to 6,000 tokens. Free on OpenRouter's free models, which allow about 50 requests a day without credits (1,000 a day after a one-time $10 top-up), so roughly 25 questions a day on the free allowance.
