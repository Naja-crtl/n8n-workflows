#!/bin/sh
# Sends sample-transcript.txt to the Intake Agent webhook.
# Usage: INTAKE_WEBHOOK_KEY=... ./test.sh <n8n host>
#    or ./test.sh <n8n host> and paste the key when asked (it isn't shown or saved in shell history).
set -e
cd "$(dirname "$0")"
HOST="${1:?usage: ./test.sh <n8n host, like n8n.example.com>}"
KEY="${INTAKE_WEBHOOK_KEY:-}"
if [ -z "$KEY" ]; then
  printf 'Paste the webhook key, then Enter: '
  stty -echo; read -r KEY; stty echo; echo
fi
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
[ -n "$KEY" ] || { echo "No key: set INTAKE_WEBHOOK_KEY or copy the key first" >&2; exit 1; }
echo "Key: ${#KEY} characters, starts with $(printf '%s' "$KEY" | cut -c1-4)"
jq -Rs '{transcript: ., contact_id: "test-1"}' sample-transcript.txt |
  curl -sS --max-time 30 -w '\nHTTP %{http_code}\n' -X POST "https://$HOST/webhook/intake" \
    -H "X-Intake-Key: $KEY" -H 'content-type: application/json' --data @-
