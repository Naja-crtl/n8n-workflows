# Worker integration

How a Cloudflare Worker (or any checker) reports results to this workflow.

## Endpoint

```
POST https://<your-n8n-host>/webhook/demo-checks
Content-Type: application/json
X-Webhook-Secret: <shared secret>
```

- The production URL only works once the workflow is **published**.
- A wrong or missing secret returns `403`. An invalid payload returns `500` with the reason in the n8n execution log.
- A valid payload returns `202` with `{"received": <number of demos>}`.

## Payload

```json
{
  "ran_at": "2026-11-07T04:00:03Z",
  "source": "my-checker-worker",
  "demos": [
    { "name": "DemoApp", "ok": true, "wake_ms": 41200, "page_ms": 820, "status_code": 200, "problem": null },
    { "name": "OtherDemo", "ok": false, "wake_ms": null, "page_ms": null, "status_code": 502,
      "problem": "Health check timed out after 180s",
      "details": { "rndr_id": "...", "cf_ray": "..." } }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `ran_at` | yes | ISO 8601 time the run started. Use the same value for every demo in the run; together with `name` it makes retries safe (duplicates are ignored). |
| `source` | no | Short label for the sender, max 60 chars. |
| `demos[].name` | yes | Letters, numbers, spaces, `.`, `_`, `-`; max 60 chars. |
| `demos[].ok` | yes | `true` only if the demo actually passed (not "the job finished"). |
| `demos[].wake_ms` | no | Time until `/health` answered. |
| `demos[].page_ms` | no | Time to load the main page. |
| `demos[].status_code` | no | Last HTTP status seen. |
| `demos[].problem` | no | Short human-readable reason, max 500 chars. |
| `demos[].details` | no | Any extra JSON (IDs, headers). Stored as `jsonb`, max 4 KB. |

## Schedule

Run the check daily at **04:00 UTC** (08:00 Asia/Dubai). The workflow's missed-run alert fires at 08:30 Dubai if nothing has arrived.

## Worker side (TypeScript example)

Store the URL and secret as Worker settings, never in code:

```bash
npx wrangler secret put N8N_WEBHOOK_SECRET   # paste the shared secret
# and in wrangler.toml / wrangler.jsonc vars: N8N_DEMO_WEBHOOK_URL = "https://<your-n8n-host>/webhook/demo-checks"
```

Send the results after the checks finish. Reporting must never break the Worker's own alerts:

```ts
async function reportToN8n(env: Env, ranAt: string, demos: DemoResult[]): Promise<void> {
  if (!env.N8N_DEMO_WEBHOOK_URL || !env.N8N_WEBHOOK_SECRET) return;
  try {
    const res = await fetch(env.N8N_DEMO_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": env.N8N_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ ran_at: ranAt, source: "my-checker-worker", demos }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`n8n report failed: ${res.status}`);
  } catch (err) {
    console.warn("n8n report error", err);
  }
}

// In the scheduled handler, after the checks:
// ctx.waitUntil(reportToN8n(env, ranAt, results));
```

## Testing by hand

```bash
curl -i -X POST "https://<your-n8n-host>/webhook-test/demo-checks" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <shared secret>" \
  -d '{"ran_at":"2026-11-07T04:00:03Z","demos":[{"name":"DemoApp","ok":true,"wake_ms":1200}]}'
```

`/webhook-test/` works while the workflow is open in the editor and listening (**Execute workflow**); `/webhook/` is the published URL.
