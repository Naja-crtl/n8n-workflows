-- Run once in the Supabase SQL Editor before importing the workflow.
-- Keeps leads in their own schema, separate from n8n's internal tables.

create schema if not exists crm;

create table if not exists crm.leads (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  phone       text,
  company     text,
  message     text not null,
  source      text not null default 'n8n-form',
  status      text not null default 'new'
              check (status in ('new', 'contacted', 'won', 'lost', 'spam'))
);

create index if not exists leads_created_at_idx on crm.leads (created_at desc);
create index if not exists leads_email_idx on crm.leads (lower(email));

-- Data API is off for this project, but keep RLS on as a second layer.
alter table crm.leads enable row level security;
