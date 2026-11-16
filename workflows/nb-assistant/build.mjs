// Builds workflow.json from this file: edit here, then run `node build.mjs` and import workflow.json into n8n.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const OUT = new URL('./workflow.json', import.meta.url).pathname;
const ASK = 'http://host.docker.internal:8101/api/ask'; // dashboards API on the VM host (not through Caddy)
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ parameters, id: randomUUID(), name, type, typeVersion, position, ...extra });
const code = (name, position, js) => node(name, 'n8n-nodes-base.code', 2, position, { jsCode: js.trim() + '\n' });

const nodes = [
  node('Setup note', 'n8n-nodes-base.stickyNote', 1, [-80, -340], {
    content:
      '## NB Assistant\n`/ask <question>` in Slack → this workflow → the dashboards API (`/api/ask`): an LLM (OpenRouter, free models with fallback) calls the dashboard queries as tools and writes the answer.\n' +
      '1. Server `.env`: `SLACK_SIGNING_SECRET` (same Slack app as the Intake Agent)\n2. Slack app manifest: slash command `/ask` with URL `https://<n8n host>/webhook/leads-ask`, scope `commands`\n3. Dashboards API: `OPENROUTER_API_KEY` (and optionally `ASK_MODELS`) in `/etc/dashboards-api.env`\n4. Workflow settings > Error workflow: **Error Alerts**',
    height: 280,
    width: 520,
  }),
  node('Slack /ask', 'n8n-nodes-base.webhook', 2, [0, 0], {
    httpMethod: 'POST',
    path: 'leads-ask',
    responseMode: 'responseNode',
    options: { rawBody: true },
  }),
  code('Verify Slack request', [220, 0], `
// Slack signs each request: HMAC-SHA256 of "v0:<timestamp>:<raw body>" with the app's signing secret.
// Anyone can call this URL, so nothing runs until the signature and timestamp check out.
const crypto = require('crypto');
const headers = $input.first().json.headers;
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
const ts = Number(headers['x-slack-request-timestamp']);
if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw new Error('Slack request is too old or has no timestamp');
const expected = 'v0=' + crypto.createHmac('sha256', $env.SLACK_SIGNING_SECRET).update(\`v0:\${ts}:\${raw}\`).digest('hex');
const got = String(headers['x-slack-signature'] ?? '');
if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
  throw new Error('Slack signature does not match');
}

// A slash command is a form: text, user_name, response_url, ... Parsed by hand (no URLSearchParams in the sandbox).
const form = Object.fromEntries(raw.split('&').map((part) => {
  const [k, v = ''] = part.split('=');
  return [decodeURIComponent(k), decodeURIComponent(v.replace(/\\+/g, ' '))];
}));
return [{ json: { question: String(form.text ?? '').trim().slice(0, 500), user: form.user_name, response_url: form.response_url } }];
`),
  // Slack wants an answer within 3 seconds; the real answer follows through response_url.
  node('Acknowledge', 'n8n-nodes-base.respondToWebhook', 1.1, [440, 0], {
    respondWith: 'json',
    responseBody:
      "={{ JSON.stringify($json.question.length < 2 ? { response_type: 'ephemeral', text: 'Ask about leads, marketing posts, demos, workflows or intakes, for example: `/ask which demo was down this week?`' } : { response_type: 'ephemeral', text: ':mag: Looking it up…' }) }}",
    options: {},
  }),
  node('Has a question?', 'n8n-nodes-base.if', 2.2, [660, 0], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: randomUUID(), leftValue: "={{ $('Verify Slack request').first().json.question.length }}", rightValue: 2, operator: { type: 'number', operation: 'gte' } }],
      combinator: 'and',
    },
    options: {},
  }),
  node(
    'Ask (AI + tools)',
    'n8n-nodes-base.httpRequest',
    4.2,
    [880, -100],
    {
      method: 'POST',
      url: ASK,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ question: $('Verify Slack request').first().json.question }) }}",
      // Free models can be slow and the API tries the next one after 40 s; Slack's reply link stays valid for 30 minutes.
      options: { timeout: 240000 },
    },
    { onError: 'continueRegularOutput' },
  ),
  node('Reply in Slack', 'n8n-nodes-base.httpRequest', 4.2, [1100, -100], {
    method: 'POST',
    url: "={{ $('Verify Slack request').first().json.response_url }}",
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({
  response_type: 'in_channel',
  text: '*' + $('Verify Slack request').first().json.user + ' asked:* ' + $('Verify Slack request').first().json.question + '\\n' +
    ($json.answer ?? (':warning: Couldn\\'t answer right now (' + String($json.error?.message ?? $json.error ?? 'no answer').slice(0, 120) + '). Try again in a minute.')) +
    ($json.tools_used?.length ? '\\n_Looked at: ' + [...new Set($json.tools_used)].join(', ') + (($json.model ? ' · ' + $json.model : '')) + '_' : '')
}) }}`,
    options: { timeout: 15000 },
  }),
];

const to = (name) => ({ main: [[{ node: name, type: 'main', index: 0 }]] });
const connections = {
  'Slack /ask': to('Verify Slack request'),
  'Verify Slack request': to('Acknowledge'),
  Acknowledge: to('Has a question?'),
  'Has a question?': { main: [[{ node: 'Ask (AI + tools)', type: 'main', index: 0 }], []] },
  'Ask (AI + tools)': to('Reply in Slack'),
};

writeFileSync(OUT, JSON.stringify({ name: 'NB Assistant', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Dubai' }, pinData: {} }, null, 2) + '\n');
console.log(`wrote ${OUT} (${nodes.length} nodes)`);
