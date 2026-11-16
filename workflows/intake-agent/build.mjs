// Builds workflow.json from this file: edit here, then run `node build.mjs` and import workflow.json into n8n.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const OUT = new URL('./workflow.json', import.meta.url).pathname;

const SERVICE = 'http://host.docker.internal:8100';
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ parameters, id: randomUUID(), name, type, typeVersion, position, ...extra });
const code = (name, position, js) => node(name, 'n8n-nodes-base.code', 2, position, { jsCode: js.trim() + '\n' });
const http = (name, position, parameters, extra) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, parameters, extra);
const pg = (name, position, query, params) =>
  node(name, 'n8n-nodes-base.postgres', 2.5, position, { operation: 'executeQuery', query, options: params ? { queryReplacement: params } : {} });
const slackPost = (name, position, body) =>
  http(name, position, {
    method: 'POST',
    url: 'https://slack.com/api/chat.postMessage',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'slackApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: body,
    options: { timeout: 15000 },
  });
// The files.* methods take form fields, not JSON.
const slackForm = (name, position, method, fields) =>
  http(name, position, {
    method: 'POST',
    url: `https://slack.com/api/${method}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'slackApi',
    sendBody: true,
    contentType: 'form-urlencoded',
    bodyParameters: { parameters: fields.map(([name, value]) => ({ name, value })) },
    options: { timeout: 15000 },
  });
// Slack answers 200 with ok: false on errors (not_in_channel, invalid_blocks), so check the body.
const slackCheck = (name, position) => code(name, position, "if (!$json.ok) throw new Error(`Slack: ${$json.error}`);\nreturn $input.all();");

const PROMPT = [
  'NB-Systems builds custom business software for small businesses in Lebanon: POS, gas station and distributor systems, websites and apps.',
  'You read a new lead (a quote request or contact form message) or notes from a call with a prospect, and fill in the intake for the build.',
  'Use only what the text says. Never invent tools, people, numbers or logins. A short message gives a short intake: put what is missing in open_questions.',
  "The lead's name, email and phone are kept by NB-Systems and removed from the text on purpose: never ask for contact details.",
  'client: the company name; if none is given, describe the business in a few words, for example "Supermarket in Saida".',
  'summary: 2 or 3 full sentences: how they work today, what they want, and the main constraint.',
  'systems: the tools they use today or that the new system must connect to (Excel, an old POS, WhatsApp Business, a website, paper). Features they want (stock, accounts, Arabic, a mobile app) are goals, not systems. owner: who controls it, if said.',
  "access_needed: what to ask the client for, as role plus account, for example 'Admin login to the current POS' or 'Export of the Excel stock sheet'. If not said, write what the build would need and add a question to open_questions.",
  'integrations: every way data moves between systems that was described.',
  'risks: worries or constraints they raised, such as timing, budget, internet, or staff skills.',
  'open_questions: what is still unknown and needed before quoting or building.',
].join('\n');

const nodes = [
  node('Setup note', 'n8n-nodes-base.stickyNote', 1, [-80, -420], {
    content:
      '## Intake Agent\nA new lead (or call notes) → structured intake (Gemini, then OpenRouter free models) → document (FastAPI service) → Slack approval → Supabase.\n' +
      '1. Run `setup.sql` in Supabase, start the service (README)\n2. Credentials: Header Auth on **GHL call note**, Header Auth `x-goog-api-key` on **Extract intake (Gemini)**, Header Auth `Authorization: Bearer <OpenRouter key>` on **Fallback**, Header Auth `Authorization: Bearer …` on **Render document**, Slack API on the Slack nodes, Postgres on the DB nodes\n' +
      '3. **Build approval message**: set `CHANNEL` to the channel ID\n4. Server `.env`: `SLACK_SIGNING_SECRET`; n8n needs `extra_hosts: host.docker.internal:host-gateway`\n5. Slack app > Interactivity: `https://<n8n host>/webhook/intake-slack`\n6. Workflow settings > Error workflow: **Error Alerts**',
    height: 360,
    width: 520,
  }),

  // ---------- 1. a call comes in ----------
  node('GHL call note', 'n8n-nodes-base.webhook', 2, [0, 0], {
    httpMethod: 'POST',
    path: 'intake',
    authentication: 'headerAuth',
    responseMode: 'onReceived',
    options: {},
  }),
  // Lead Capture calls this workflow with a new lead's id; the lead (with contact details) is read here.
  node('New lead (from Lead Capture)', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, -200], {
    inputSource: 'workflowInputs',
    workflowInputs: { values: [{ name: 'lead_id', type: 'number' }] },
  }),
  pg(
    'Load lead',
    [220, -200],
    'SELECT id, name, email, phone, company, message, source FROM crm.leads WHERE id = $1;',
    '={{ [ $json.lead_id ] }}',
  ),
  // Both starts end up here as one shape. Only "transcript" goes to the AI: names, emails and phone numbers are
  // kept in "contact" (n8n adds them to Slack and the document) and scrubbed from the text (free AI tiers may
  // learn from what they receive).
  code('Read transcript', [440, 0], `
const j = $input.first().json;
const scrub = (t) => String(t ?? '')
  .split('\\n').filter((l) => !/^\\s*(name|email|e-mail|phone|mobile|whatsapp)\\s*:/i.test(l)).join('\\n') // website quote answers
  .replace(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, '[email]')
  .replace(/\\+?\\d[\\d\\s().-]{6,}\\d/g, '[phone]');

if (j.message !== undefined && j.id) {
  // A lead from crm.leads
  const text = [\`Source: \${j.source}\`, \`Company: \${j.company || 'not given'}\`, 'Message:', scrub(j.message)].join('\\n');
  if (scrub(j.message).trim().length < 10) throw new Error(\`Lead #\${j.id} has no usable message\`);
  return [{ json: {
    transcript: text.slice(0, 60000),
    lead_id: j.id,
    contact_id: '',
    contact: { name: j.name, email: j.email, phone: j.phone, company: j.company, source: j.source },
  } }];
}

// Call notes or a transcript sent to the webhook (GoHighLevel-style body, or test.sh)
const b = j.body ?? {};
const d = { ...b, ...(b.customData ?? {}) };
const transcript = String(d.transcript ?? d.note ?? '').trim();
if (transcript.length < 200) {
  throw new Error(\`No transcript in the webhook (\${transcript.length} characters). Send it as "transcript".\`);
}
return [{ json: {
  transcript: scrub(transcript).slice(0, 60000),
  lead_id: d.lead_id ? Number(d.lead_id) : null,
  contact_id: String(d.contact_id ?? d.contactId ?? ''),
  contact: null,
} }];
`),
  http('Get schema', [660, 0], { url: `${SERVICE}/schema`, options: { timeout: 10000 } }),
  http(
    'Extract intake (Gemini)',
    [880, 0],
    {
      method: 'POST',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({
  systemInstruction: { parts: [{ text: ${JSON.stringify(PROMPT)} }] },
  contents: [{ role: 'user', parts: [{ text: $('Read transcript').first().json.transcript }] }],
  generationConfig: { responseMimeType: 'application/json', responseJsonSchema: $json, temperature: 0.2 }
}) }}`,
      options: { timeout: 60000 },
    },
    // Still failing after the retry (rate limit, outage): the error output goes to the fallback model.
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueErrorOutput' },
  ),
  // One request, three free models with exact-JSON support (checked on openrouter.ai/api/v1/models): OpenRouter
  // moves to the next model when one is busy or down, and require_parameters keeps it to models that honour the
  // JSON schema. Free models come and go: if one disappears, pick another with "structured_outputs".
  http(
    'Fallback: OpenRouter (free)',
    [880, 220],
    {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({
  models: ['nvidia/nemotron-3.5-super-vl:free', 'inclusionai/ling-3.2-flash:free', 'baidu/ernie-5.5-flash-preview:free'],
  provider: { require_parameters: true },
  messages: [
    { role: 'system', content: ${JSON.stringify(PROMPT)} },
    { role: 'user', content: $('Read transcript').first().json.transcript }
  ],
  response_format: { type: 'json_schema', json_schema: { name: 'intake', strict: false, schema: $('Get schema').first().json } },
  temperature: 0.2
}) }}`,
      options: { timeout: 120000 },
    },
    { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
  ),
  code('Parse intake', [1100, 0], `
// Gemini puts the JSON in candidates, OpenRouter (the fallback) in choices. No text means the model blocked or
// cut the answer. The service checks the shape again in Render document, so a malformed intake stops there.
const r = $input.first().json;
const gemini = Boolean(r.candidates);
const raw = gemini
  ? (r.candidates[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  : r.choices?.[0]?.message?.content ?? '';
const text = String(raw).replace(/^\\s*\`\`\`(json)?|\`\`\`\\s*$/g, '').trim();
if (!text) throw new Error(\`\${gemini ? 'Gemini' : 'Fallback model'} returned no intake: \${r.candidates?.[0]?.finishReason ?? r.choices?.[0]?.finish_reason ?? r.promptFeedback?.blockReason ?? r.error?.message ?? 'empty answer'}\`);
return [{ json: {
  intake: JSON.parse(text),
  contact_id: $('Read transcript').first().json.contact_id,
  model: gemini ? 'gemini-flash-latest' : r.model ?? 'unknown',
  tokens: r.usageMetadata?.totalTokenCount ?? r.usage?.total_tokens ?? null,
} }];
`),
  http('Render document', [1100, 0], {
    method: 'POST',
    url: `${SERVICE}/render`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.intake) }}',
    options: { response: { response: { responseFormat: 'text' } }, timeout: 10000 },
  }),
  pg(
    'Save draft',
    [1320, 0],
    'INSERT INTO intake.intakes (client, contact_id, lead_id, intake, document, llm_model, llm_tokens)\nVALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)\nRETURNING id;',
    "={{ [ $('Parse intake').first().json.intake.client, $('Parse intake').first().json.contact_id, $('Read transcript').first().json.lead_id, JSON.stringify($('Parse intake').first().json.intake), $json.data, $('Parse intake').first().json.model, $('Parse intake').first().json.tokens ] }}",
  ),
  code('Build approval message', [1540, 0], `
const CHANNEL = 'YOUR_CHANNEL_ID'; // Slack: channel details > About > Channel ID
const i = $('Parse intake').first().json.intake;
const id = String($json.id);
const cut = (s, n = 2900) => (s.length > n ? s.slice(0, n - 1) + '…' : s); // Slack's limit per text block is 3000
// Slack mrkdwn reads <...> as links and mentions, so LLM text like "<client account>/admin" would vanish.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const c = $('Read transcript').first().json.contact; // from crm.leads, never from the AI
const lead = $('Read transcript').first().json.lead_id;

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: cut(\`Intake: \${i.client}\`, 150) } },
  { type: 'section', text: { type: 'mrkdwn', text: cut(esc(i.summary)) } },
  { type: 'section', text: { type: 'mrkdwn', text: cut('*Access to request*\\n' + i.systems.map((s) => \`• *\${esc(s.name)}*: \${esc(s.access_needed.join(', ') || 'not said yet')}\`).join('\\n')) } },
];
if (c) {
  const line = [c.name, c.email, c.phone].filter(Boolean).map(esc).join(' · ');
  blocks.splice(1, 0, { type: 'section', text: { type: 'mrkdwn', text: cut(\`*Lead #\${lead}* (\${esc(c.source)}): \${line || 'no contact details'}\`) } });
}
if (i.open_questions?.length) {
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: cut('Open questions: ' + esc(i.open_questions.join(' · '))) }] });
}
blocks.push({
  type: 'actions',
  elements: [
    { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, value: id },
    { type: 'button', action_id: 'reject', style: 'danger', text: { type: 'plain_text', text: 'Reject' }, value: id },
  ],
});
return [{ json: { channel: CHANNEL, text: \`Intake for \${i.client} is waiting for approval\`, blocks } }];
`),
  slackPost('Ask for approval (Slack)', [1760, 0], '={{ JSON.stringify($json) }}'),
  slackCheck('Check Slack', [1980, 0]),

  // ---------- 2. someone clicks Approve or Reject ----------
  node('Slack button', 'n8n-nodes-base.webhook', 2, [0, 420], {
    httpMethod: 'POST',
    path: 'intake-slack',
    responseMode: 'onReceived',
    options: { rawBody: true },
  }),
  code('Verify Slack request', [220, 420], `
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

// Slack sends one form field, payload=<JSON>. Parsed by hand: n8n's Code sandbox has no URLSearchParams.
const field = raw.split('&').find((part) => part.startsWith('payload='));
if (!field) throw new Error('Slack request has no payload');
const p = JSON.parse(decodeURIComponent(field.slice('payload='.length).replace(/\\+/g, ' ')));
const action = p.actions?.[0]?.action_id;
if (action !== 'approve' && action !== 'reject') throw new Error(\`Unknown Slack action: \${action}\`);
return [{ json: {
  status: action === 'approve' ? 'approved' : 'rejected',
  id: Number(p.actions[0].value),
  user: p.user?.username ?? p.user?.name ?? p.user?.id,
  channel: p.container?.channel_id ?? p.channel?.id,
  ts: p.container?.message_ts,
  response_url: p.response_url,
} }];
`),
  // Only a pending intake can be decided, so a second click (or a replayed request) changes nothing.
  pg(
    'Record decision',
    [440, 420],
    "UPDATE intake.intakes i SET status = $1, decided_by = $2, decided_at = now()\nWHERE i.id = $3 AND i.status = 'pending'\nRETURNING i.id, i.client, i.status, i.document, i.lead_id,\n  (SELECT json_build_object('name', l.name, 'email', l.email, 'phone', l.phone, 'source', l.source) FROM crm.leads l WHERE l.id = i.lead_id) AS contact;",
    '={{ [ $json.status, $json.user, $json.id ] }}',
  ),
  // An UPDATE that matched nothing still outputs { success: true }: drop it, the intake was already decided.
  code('Still pending?', [660, 420], 'return $input.all().filter((item) => item.json.id);'),
  node('Approved?', 'n8n-nodes-base.if', 2.2, [880, 420], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: randomUUID(), leftValue: '={{ $json.status }}', rightValue: 'approved', operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  }),
  // The document goes to the thread as a .md file: as a message, its Markdown (table, diagram fences) breaks.
  // Slack's upload is 3 calls: get an upload URL for the file's size, send the bytes, then share it in the thread.
  code('Prepare file', [1100, 340], `
const r = $input.first().json;
const slug = r.client.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
// The lead's contact details go into the file here, from crm.leads (the AI never saw them).
const c = r.contact;
const contact = c
  ? ['## Contact', '', \`- Lead #\${r.lead_id} (\${c.source})\`, ...[['Name', c.name], ['Email', c.email], ['Phone', c.phone]].filter(([, v]) => v).map(([k, v]) => \`- \${k}: \${v}\`), '', ''].join('\\n')
  : '';
const [title, ...rest] = r.document.split('\\n');
const document = [title, '', contact + rest.join('\\n').replace(/^\\n+/, '')].join('\\n');
return [{ json: {
  filename: \`\${slug}-intake.md\`,
  title: \`\${r.client}: architecture and access\`,
  length: Buffer.byteLength(document, 'utf8'),
  document,
} }];
`),
  slackForm('Get upload URL (Slack)', [1320, 340], 'files.getUploadURLExternal', [
    ['filename', '={{ $json.filename }}'],
    ['length', '={{ $json.length }}'],
  ]),
  slackCheck('Check upload URL', [1540, 340]),
  http('Upload file', [1760, 340], {
    method: 'POST',
    url: '={{ $json.upload_url }}',
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'text/markdown; charset=utf-8',
    body: "={{ $('Prepare file').first().json.document }}",
    options: { response: { response: { responseFormat: 'text' } }, timeout: 30000 },
  }),
  slackForm('Share in thread (Slack)', [1980, 340], 'files.completeUploadExternal', [
    ['files', "={{ JSON.stringify([{ id: $('Check upload URL').first().json.file_id, title: $('Prepare file').first().json.title }]) }}"],
    ['channel_id', "={{ $('Verify Slack request').first().json.channel }}"],
    ['thread_ts', "={{ $('Verify Slack request').first().json.ts }}"],
  ]),
  slackCheck('Check share', [2200, 340]),
  // Replaces the message with the decision, so the buttons can't be clicked again.
  http('Update message', [2420, 440], {
    method: 'POST',
    url: "={{ $('Verify Slack request').first().json.response_url }}",
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      "={{ JSON.stringify({ replace_original: true, text: ($('Record decision').first().json.status === 'approved' ? ':white_check_mark: ' : ':x: ') + 'Intake for ' + $('Record decision').first().json.client + ' ' + $('Record decision').first().json.status + ' by ' + $('Verify Slack request').first().json.user }) }}",
    options: { timeout: 15000 },
  }),

  // ---------- 3. data retention ----------
  node('Daily at 03:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 760], {
    rule: { interval: [{ field: 'cronExpression', expression: '0 3 * * *' }] },
  }),
  pg('Delete old rejected', [220, 760], "DELETE FROM intake.intakes\nWHERE status = 'rejected' AND decided_at < now() - interval '30 days';"),
];

const to = (name) => ({ main: [[{ node: name, type: 'main', index: 0 }]] });
const connections = {
  'GHL call note': to('Read transcript'),
  'New lead (from Lead Capture)': to('Load lead'),
  'Load lead': to('Read transcript'),
  'Read transcript': to('Get schema'),
  'Get schema': to('Extract intake (Gemini)'),
  'Extract intake (Gemini)': { main: [[{ node: 'Parse intake', type: 'main', index: 0 }], [{ node: 'Fallback: OpenRouter (free)', type: 'main', index: 0 }]] },
  'Fallback: OpenRouter (free)': to('Parse intake'),
  'Parse intake': to('Render document'),
  'Render document': to('Save draft'),
  'Save draft': to('Build approval message'),
  'Build approval message': to('Ask for approval (Slack)'),
  'Ask for approval (Slack)': to('Check Slack'),
  'Slack button': to('Verify Slack request'),
  'Verify Slack request': to('Record decision'),
  'Record decision': to('Still pending?'),
  'Still pending?': to('Approved?'),
  'Approved?': { main: [[{ node: 'Prepare file', type: 'main', index: 0 }], [{ node: 'Update message', type: 'main', index: 0 }]] },
  'Prepare file': to('Get upload URL (Slack)'),
  'Get upload URL (Slack)': to('Check upload URL'),
  'Check upload URL': to('Upload file'),
  'Upload file': to('Share in thread (Slack)'),
  'Share in thread (Slack)': to('Check share'),
  'Check share': to('Update message'),
  'Daily at 03:00': to('Delete old rejected'),
};

writeFileSync(
  OUT,
  JSON.stringify({ name: 'Intake Agent', nodes, connections, settings: { executionOrder: 'v1', timezone: 'Asia/Dubai' }, pinData: {} }, null, 2) + '\n',
);
console.log(`wrote ${OUT} (${nodes.length} nodes)`);
