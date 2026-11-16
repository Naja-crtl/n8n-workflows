-- Run once in the Supabase SQL Editor before importing the workflow.

create schema if not exists intake;

create table if not exists intake.intakes (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  client      text not null,
  contact_id  text,                     -- GoHighLevel contact, to link back
  lead_id     bigint references crm.leads (id) on delete set null,  -- the lead it came from
  intake      jsonb not null,           -- what the LLM extracted, checked by the service
  document    text not null,            -- the Markdown the service wrote
  llm_model   text,                     -- which model answered (Gemini, or the fallback)
  llm_tokens  integer,                  -- for cost per run
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  decided_by  text,                     -- Slack user who clicked Approve or Reject
  decided_at  timestamptz
);

-- For databases set up before lead_id existed:
alter table intake.intakes add column if not exists lead_id bigint references crm.leads (id) on delete set null;

create index if not exists intakes_status_idx on intake.intakes (status, decided_at);

-- Only n8n reads this table (direct Postgres connection). RLS with no policies keeps it out of the Data API.
alter table intake.intakes enable row level security;
