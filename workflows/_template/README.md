# Workflow Name

One or two sentences on what this workflow does and the problem it solves.

## How it works

1. **Trigger**: what starts it (schedule, webhook, form, app event)
2. **Step**: what happens next
3. **Output**: where the result goes

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| e.g. Google Sheets OAuth2 | Append row | Needs edit access to the target sheet |

## Setup

1. Import `workflow.json` (see the root README).
2. Create the credentials above and select them in each node.
3. Update any IDs or settings marked in the nodes (sheet ID, channel, email address).
4. Run a test, then publish.

## Configuration

| Setting | Where | Default |
|---|---|---|
| e.g. Schedule | Schedule Trigger node | Daily at 09:00 (Asia/Dubai) |

## Notes

Limits, edge cases, or ideas for extending it.
