# Hosting

n8n self-hosted on an Oracle Cloud Always Free VM.

| Part | Choice |
|---|---|
| Server | Oracle Cloud, Ampere A1 (Arm), Ubuntu 24.04, Frankfurt |
| Runtime | Docker Compose |
| HTTPS | Caddy (automatic Let's Encrypt certificates) |
| Database | Supabase Postgres via the Session pooler, Frankfurt |

## Files

- `docker-compose.yml`: n8n and Caddy services
- `Caddyfile`: reverse proxy from the public hostname to n8n
- `.env.example`: all settings, with secrets left blank

## Deploy

```bash
mkdir ~/n8n && cd ~/n8n
# copy the three files here, then:
cp .env.example .env && chmod 600 .env
nano .env        # fill in host, database details and N8N_ENCRYPTION_KEY
docker compose up -d
```

Ports 80 and 443 must be open both in the Oracle security list and in the VM's iptables rules.

## Upgrading n8n

Change the image tag in `docker-compose.yml`, then:

```bash
docker compose pull && docker compose up -d
```

Keep `N8N_ENCRYPTION_KEY` backed up outside the server. Without it, stored credentials can't be decrypted.
