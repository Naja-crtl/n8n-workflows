-- Run once in the Supabase SQL Editor before importing the workflow.
-- One row per demo per check run, so you get history, uptime and wake-up trends.

create schema if not exists ops;

create table if not exists ops.demo_checks (
  id           bigint generated always as identity primary key,
  run_at       timestamptz not null,
  demo         text not null,
  ok           boolean not null,
  wake_ms      integer,
  page_ms      integer,
  status_code  integer,
  problem      text,
  was_asleep   boolean,      -- v1.2: true if the Worker had to wake the demo, false if already awake
  details      jsonb,
  source       text not null default 'cloudflare-worker',
  received_at  timestamptz not null default now(),
  unique (run_at, demo)   -- a retried delivery of the same run is ignored
);

create index if not exists demo_checks_demo_run_idx on ops.demo_checks (demo, run_at desc);
create index if not exists demo_checks_run_idx on ops.demo_checks (run_at desc);

-- Upgrading an existing v1.0/v1.1 install? This line adds the v1.2 column (safe to run more than once).
alter table ops.demo_checks add column if not exists was_asleep boolean;

-- Data API is off for this project, but keep RLS on as a second layer.
alter table ops.demo_checks enable row level security;

-- Handy view: uptime and average wake-up time per demo over the last 30 days.
create or replace view ops.demo_uptime_30d as
select
  demo,
  count(*)                                                     as checks,
  count(*) filter (where ok)                                   as passed,
  round(100.0 * count(*) filter (where ok) / count(*), 1)      as uptime_pct,
  round(avg(wake_ms) filter (where ok) / 1000.0, 1)            as avg_wake_s,
  max(run_at)                                                  as last_check
from ops.demo_checks
where run_at >= now() - interval '30 days'
group by demo
order by demo;
