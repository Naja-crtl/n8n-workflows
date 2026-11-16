# Intake Agent

Turns a discovery call into the client's architecture and access document. A call transcript comes in from GoHighLevel, an LLM extracts the client's systems, goals, integrations and risks as structured JSON, a small FastAPI service checks it and writes the document, and a Slack message with Approve and Reject buttons lets a person sign it off before anything is saved or shared.

## How it works

1. **Trigger**: GoHighLevel webhook when a call note or transcript is added to a contact.
2. **Extract**: Gemini gets the text and the JSON schema from the service (`GET /schema`, with references inlined) and must answer in that shape. If Gemini still fails after 3 tries (rate limit, "high demand", outage), one OpenRouter request takes over with three free models that support exact JSON output (`nvidia/nemotron-3.5-super-vl`, then `inclusionai/ling-3.2-flash`, then `baidu/ernie-5.5-flash-preview`): OpenRouter moves to the next model when one is busy, and `require_parameters` keeps it to models that honour the schema. The model that answered is saved with the intake.
3. **Render**: n8n posts the JSON to the service (`POST /render`), which checks it again and returns the document in Markdown, with a table of the access to request and a data flow diagram.
4. **Approve**: a Slack message shows the summary with **Approve** and **Reject** buttons.
5. **Output**: the draft is saved in Supabase as `pending`. Approve marks it approved and attaches the document to the message's thread as a `.md` file; Reject marks it rejected. Either way the message is replaced with who decided, so the buttons can't be clicked twice. Slack's signature is checked on every click.
6. **Retention**: rejected intakes are deleted after 30 days (daily at 03:00).

## The service

| Endpoint | Auth | What it does |
|---|---|---|
| `GET /health` | none | `{"ok": true}`, for monitoring |
| `GET /schema` | none | JSON schema of an intake, used for the LLM's structured output |
| `POST /render` | `Authorization: Bearer <INTAKE_API_TOKEN>` | Checks an intake and returns the document (`text/plain` Markdown); `422` if the JSON is wrong |

Run the checks locally:

```bash
cd service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python test_main.py
```

## Deploy on the VPS (systemd)

The service runs on the host under systemd, next to n8n and Caddy in Docker. It listens on the Docker bridge (`172.17.0.1:8100`), so the containers reach it and the internet does not.

```bash
sudo useradd --system --no-create-home intake
sudo mkdir -p /opt/intake-service && sudo cp service/main.py service/requirements.txt /opt/intake-service/
cd /opt/intake-service && sudo python3 -m venv .venv && sudo .venv/bin/pip install -r requirements.txt
echo "INTAKE_API_TOKEN=$(openssl rand -hex 32)" | sudo tee /etc/intake-service.env >/dev/null
sudo chmod 600 /etc/intake-service.env
sudo cp service/intake-service.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now intake-service
journalctl -u intake-service -f   # logs
```

Oracle Cloud's Ubuntu image rejects incoming traffic that isn't SSH, including from Docker containers, so open the port to the Docker networks only:

```bash
sudo iptables -I INPUT -s 172.16.0.0/12 -p tcp --dport 8100 -j ACCEPT
sudo netfilter-persistent save
```

In `docker-compose.yml`, give the n8n service `extra_hosts: ["host.docker.internal:host-gateway"]`; n8n then calls `http://host.docker.internal:8100`. To check health from outside, add the same `extra_hosts` to Caddy and this inside the site block of the `Caddyfile`:

```
handle_path /intake/* {
	reverse_proxy host.docker.internal:8100
}
```

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Header Auth | Render document | Name `Authorization`, value `Bearer ` + the token from `/etc/intake-service.env` |
| Slack API | Ask for approval, Get upload URL, Share in thread | Bot token of the Slack app (`chat:write`, `files:write`) |
| Postgres | Save draft, Record decision, Delete old rejected | Supabase, EU region |
| Header Auth | Extract intake (Gemini) | Name `x-goog-api-key`, a key from aistudio.google.com |
| Header Auth | Fallback: OpenRouter (free) | Name `Authorization`, value `Bearer ` + an OpenRouter key |

The Slack signing secret goes in the server's `.env` as `SLACK_SIGNING_SECRET` (the workflow reads it with `$env`).

Secrets live in Bitwarden (moving them there is on the to-do list) and in the server's env files only: never in this repo, in workflow exports, or in chat.

## Build

`workflow.json` is generated: edit `build.mjs`, then run `node build.mjs`.

## Data protection (GDPR)

- Supabase project and VPS are in the EU (check both regions before publishing this).
- The service does not log request bodies; the systemd log holds only the request line and status code.
- Transcripts are not stored; only the approved intake is saved.
- Rejected intakes are deleted after 30 days.

## Cost per run

A 10-minute call transcript used about 2,500 tokens (input and output). On Gemini's free tier and the free OpenRouter fallbacks that costs nothing; every intake saves `llm_model` and `llm_tokens`, so the real cost on a paid model is one query away:

```sql
select llm_model, count(*), round(avg(llm_tokens)) as avg_tokens from intake.intakes group by 1;
```

The FastAPI service runs on the existing VPS, so it adds no hosting cost.
