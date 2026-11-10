-- Social Publisher: run once in the Supabase SQL Editor.
-- One row per client in marketing.clients. Each client's Meta Page token is kept in Supabase Vault
-- (encrypted at rest) under the name 'meta_token:<client id>', never in a table or in n8n.

create schema if not exists marketing;

create table if not exists marketing.clients (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name         text not null,
  fb_page_id   text not null,
  ig_user_id   text,
  timezone     text not null default 'Asia/Dubai',
  report_email text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- One row per post. The id is also the utm_campaign, so leads show which post brought them.
create table if not exists marketing.posts (
  id                text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  client_id         text not null references marketing.clients (id) on delete cascade,
  type              text not null check (type in ('image', 'reel')),
  media_url         text not null,
  caption           text not null,
  hashtags          text[] not null default '{}',
  link              text,
  link_on_instagram boolean not null default false,
  scheduled_at      timestamptz not null,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'paused', 'cancelled', 'publishing', 'posted', 'partial', 'failed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists posts_due on marketing.posts (status, scheduled_at);

-- One row per post and platform, so Facebook and Instagram succeed or fail separately.
create table if not exists marketing.post_targets (
  post_id      text not null references marketing.posts (id) on delete cascade,
  platform     text not null check (platform in ('facebook', 'instagram')),
  status       text not null default 'pending' check (status in ('pending', 'processing', 'posted', 'failed')),
  container_id text,
  remote_id    text,
  permalink    text,
  error        text,
  attempts     int not null default 0,
  posted_at    timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (post_id, platform)
);
create index if not exists post_targets_posted on marketing.post_targets (status, posted_at);

-- Per-post results from Meta, refreshed daily. Reports read from here, never from Meta.
create table if not exists marketing.post_insights (
  post_id    text not null references marketing.posts (id) on delete cascade,
  platform   text not null,
  reach      int,
  views      int,
  likes      int,
  comments   int,
  shares     int,
  saves      int,
  raw        jsonb not null default '{}',
  error      text,
  fetched_at timestamptz not null default now(),
  primary key (post_id, platform)
);

-- Weekly report snapshots, for week-over-week follower changes.
create table if not exists marketing.reports (
  client_id  text not null references marketing.clients (id) on delete cascade,
  week_start date not null,
  data       jsonb not null,
  summary    text,
  sent_at    timestamptz not null default now(),
  primary key (client_id, week_start)
);

-- Row level security on, no policies: only the n8n database user (which bypasses RLS) can read these.
alter table marketing.clients       enable row level security;
alter table marketing.posts         enable row level security;
alter table marketing.post_targets  enable row level security;
alter table marketing.post_insights enable row level security;
alter table marketing.reports       enable row level security;

-- Saves or replaces a client's Meta Page token in Vault. Used by the "Add a client" form.
create or replace function marketing.set_meta_token(p_client text, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = 'meta_token:' || p_client;
  if sid is null then
    perform vault.create_secret(p_token, 'meta_token:' || p_client);
  else
    perform vault.update_secret(sid, p_token);
  end if;
end $$;
revoke all on function marketing.set_meta_token(text, text) from public, anon, authenticated;
