# Social Publisher: multi-client Facebook + Instagram scheduling and reports

Schedules and publishes posts and reels to Facebook Pages and Instagram for any number of clients. Each client gets a preview email the day before something goes out, an alert if a post fails, and a weekly report with results and a short written analysis. Content is prepared ahead of time. The workflow publishes and reports, it never writes anything the audience sees.

It is the n8n version of the Cloudflare Worker that runs NB-Systems' own social media, rebuilt so one install serves many clients.

## How it works

The workflow has five parts, each with a note on the canvas.

1. **Add a client** (Form): the operator enters the client's name, Facebook Page id, timezone, report email and Page access token. The token is checked with Meta first. Only then is the client saved, and the token is stored encrypted in Supabase Vault. The Instagram account is found automatically from the Page.
2. **Schedule a post** (Form): client, post id, image or reel URL, caption, hashtags, link, platforms and time. It checks the same rules Meta applies (JPEG for Instagram, MP4 for reels, 30 hashtags at most, a timezone on the time), so an accepted post will publish.
3. **Publisher** (every 15 minutes, all clients):
   - Loads the due posts for each platform, with each client's token from Vault.
   - Builds the caption. Facebook gets the link with `utm_source`, `utm_medium=post` and `utm_campaign=<post id>`, so leads show which post brought them. Instagram leaves the link out unless asked, because links there aren't clickable.
   - **Facebook**: published in one call.
   - **Instagram**: creates a media container, waits until Meta has processed it (the next run checks again if it isn't ready), then publishes and saves the permalink.
   - **Failures**: up to 3 attempts, then the client gets an alert email. A token problem stops right away. Facebook and Instagram fail separately, so one never blocks the other.
   - Once every platform is done, the post is marked `posted`, `partial` or `failed`.
4. **Daily at 18:00**:
   - Each client gets the list of posts going out in the next 24 hours, so a post can be stopped in time. No email is sent on quiet days.
   - Reach, views, likes, comments, shares and saves for the last 30 days of posts are read from Meta and stored.
5. **Mondays at 09:00**: each client gets a weekly report with followers and the change since last week, results for each post, failed posts, and a 3 to 5 sentence analysis from Gemini. If Gemini is down, the report still goes out without the analysis. Each week is saved for the next comparison.

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Basic Auth | Add a client, New post | Operator only. The forms are public URLs, so this login is required. |
| Postgres | every Postgres node | Same Supabase credential as the other workflows. Its user must be able to read `vault.decrypted_secrets` (the default `postgres` user can). |
| SMTP | Send failure alert, Send preview, Send report | Any SMTP provider, for example Brevo (free, 300 emails a day). |
| Header Auth | Gemini analysis | Name `x-goog-api-key`, value: a key from aistudio.google.com. |

Each client's Meta Page token is not an n8n credential. It lives in Supabase Vault as `meta_token:<client id>`, so adding a client never means editing the workflow.

## Setup

1. Run [`setup.sql`](setup.sql) in the Supabase **SQL Editor**. It creates the `marketing` schema and the `marketing.set_meta_token` function.
2. Import `workflow.json` into n8n.
3. Create the credentials above, select them in the matching nodes, and replace `YOUR_FROM_EMAIL` in the three email nodes.
4. Optional: select [Error Alerts](../error-alerts/) under **Settings > Error workflow**.
5. **Publish**, open the **Add a client** form URL and add the first client.
6. Schedule a test post a few minutes ahead with the **New post** form and watch it go out.

### Getting a client's Page token

The client adds your Meta Business as a partner on their Page and Instagram account. In your Business Settings, a System User with the Page assigned can then generate a token that never expires, with `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic` and `instagram_content_publish`. Paste it into the **Add a client** form. If the token is ever revoked, the client gets an alert email that says so, and submitting the form again replaces it.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Publish check | Every 15 minutes node | Every 15 minutes |
| Preview and results refresh | Daily 18:00 node | 18:00 (workflow timezone, Asia/Dubai) |
| Weekly report | Monday 09:00 node | Monday 09:00 |
| Graph API version | URL of each Meta HTTP node | `v26.0` |
| Retries before giving up | Describe failure node | 3 |
| Posts per publish run | Load due posts query | 20 |
| Posts refreshed per day | Posts to refresh query | 50 |

Times in emails use each client's own timezone.

## Notes

- **Media** must be at a public https URL that Meta can download, for example a public Supabase Storage bucket. Images: `.jpg` for Instagram (`.png` is fine for Facebook only). Reels: `.mp4` with H.264 video and AAC audio, vertical 1080x1920, 3 to 90 seconds.
- **Pausing a post**: `update marketing.posts set status = 'paused' where id = '<id>';` and `'scheduled'` to resume. **Retrying a failed post**: `update marketing.post_targets set status = 'pending', attempts = 0 where post_id = '<id>';` and `update marketing.posts set status = 'publishing' where id = '<id>';`
- **Execution data**: the client tokens pass through the workflow, so successful executions are not saved (Settings). Failed executions are kept for debugging, so only admins should have access to the n8n instance. When recording a demo, don't open the output of the token-carrying nodes on screen.
- **Left out of this version**: LinkedIn, carousels (several images in one post) and website leads in the weekly report. The Cloudflare Worker version has all three, and each is a separate branch to add here.
