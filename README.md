# n8n Workflows

Automation workflows built with [n8n](https://n8n.io), running on a self-hosted instance. Each workflow is importable as JSON and comes with its own README.

## Workflows

| Workflow | What it does | Trigger |
|---|---|---|
| _Coming soon_ | | |

## Repository layout

```
workflows/
  <workflow-name>/
    workflow.json   importable n8n workflow
    README.md       what it does, setup, credentials needed
  _template/        starting point for new workflows
infra/              hosting config for the n8n instance
```

## Importing a workflow

1. Download `workflow.json` from the workflow's folder.
2. In n8n: **Workflows > Create workflow**, then the **⋯** menu > **Import from File**.
3. Create the credentials listed in that workflow's README and select them in the matching nodes.
4. Test the workflow, then publish/activate it.

## Credentials and secrets

No API keys, tokens or passwords are stored in this repository. Workflow files only reference n8n credentials by name, so you create your own credentials after importing.

## Hosting

The instance runs n8n in Docker on an Oracle Cloud Always Free Arm VM, with Caddy for automatic HTTPS and a Supabase Postgres database for workflows and credentials. Config is in [`infra/`](infra/).

## Author

Naja Boughader · [GitHub](https://github.com/Naja-crtl) · [LinkedIn](https://www.linkedin.com/in/naja-bou-ghader-1a2822249)
