# Lead Capture: Form to Supabase + Telegram Alert

A public contact form that cleans and validates every submission, stores it in a Postgres (Supabase) `leads` table, and sends an instant Telegram alert for genuine leads. Spam-looking entries are saved too, and sent as a silent "possible spam" alert with the reason, so real leads are never missed.

## How it works

1. **Contact form** (n8n Form Trigger): hosted form with Name, Email, Phone, Company and Message.
2. **Normalize & validate** (Code): trims and tidies the text, lowercases the email, checks the email format and message length, flags messages with too many links, and HTML-escapes everything for the alert.
3. **Save lead** (Postgres): inserts the row into `crm.leads` with a parameterized query (no SQL injection risk) and returns the new ID.
4. **Is genuine lead?** (If): splits on status `new` or `spam`.
5. **Telegram alert**: sends genuine leads to your chat with a normal notification.
6. **Telegram spam review**: sends flagged entries silently, with the reason they were flagged and the SQL to restore them.

## Credentials needed

| n8n credential type | Used by node | Notes |
|---|---|---|
| Postgres | Save lead | Supabase **Session pooler** host, port 5432, database `postgres`, user `postgres.<project-ref>`, SSL **Require**, and turn on **Ignore SSL Issues** (Supabase's certificate chain isn't trusted by default; traffic stays encrypted) |
| Telegram API | Telegram alert, Telegram spam review | Bot token from [@BotFather](https://t.me/BotFather) |

## Setup

1. **Create the table**: open the Supabase **SQL Editor**, paste [`setup.sql`](setup.sql) and run it.
2. **Create a Telegram bot**: message @BotFather, send `/newbot`, follow the prompts, and copy the token.
3. **Find your chat ID**: send any message to your new bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `message.chat.id`.
4. **Import** `workflow.json` into n8n (see the root README).
5. In **Save lead**, create/select the Postgres credential.
6. In **Telegram alert** and **Telegram spam review**, select the Telegram credential and replace `YOUR_TELEGRAM_CHAT_ID` with your chat ID.
7. Open **Contact form**, use **Test step**, submit a sample lead, and check the row in Supabase and the alert on Telegram.
8. **Publish** the workflow. The production form URL is shown in the Contact form node (path `/form/contact`).

## Configuration

| Setting | Where | Default |
|---|---|---|
| Form fields and texts | Contact form node | Name, Email, Phone, Company, Message |
| Form URL path | Contact form > Options > Path | `contact` |
| Spam rules | Normalize & validate code | Name under 2 chars, invalid email, message under 10 chars, more than 2 links |
| Alert time zone | Telegram alert text | Asia/Dubai |

## Using it on a website

Link to the form URL directly, or embed it in your site with an iframe:

```html
<iframe src="https://<your-n8n-host>/form/contact" width="100%" height="720" style="border:0"></iframe>
```

## Ideas for extending it

- Auto-reply email to the visitor (Gmail or SMTP node).
- Duplicate check: look up the email in `crm.leads` before inserting.
- Weekly summary of new leads by status.
- Reply buttons in the Telegram alert to mark a lead as contacted.
