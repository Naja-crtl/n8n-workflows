-- Run once in the Supabase SQL Editor before importing the workflow.
-- One row per message from demo-proxy: a visitor woke a demo (waking), it opened (opened),
-- or it didn't start (refused, slow).

create schema if not exists ops;

create table if not exists ops.demo_alerts (
  id           bigint generated always as identity primary key,
  alert_at     timestamptz not null,
  demo         text not null,
  host         text,
  reason       text not null check (reason in ('waking', 'opened', 'refused', 'slow')),
  details      jsonb,
  source       text not null default 'demo-proxy',
  received_at  timestamptz not null default now(),
  unique (alert_at, demo)   -- a retried delivery is ignored
);

-- Tables created before waking/opened existed: widen the reason check (safe to run again).
alter table ops.demo_alerts drop constraint if exists demo_alerts_reason_check;
alter table ops.demo_alerts add constraint demo_alerts_reason_check check (reason in ('waking', 'opened', 'refused', 'slow'));

create index if not exists demo_alerts_demo_at_idx on ops.demo_alerts (demo, alert_at desc);

-- Data API is off for this project, but keep RLS on as a second layer.
alter table ops.demo_alerts enable row level security;
