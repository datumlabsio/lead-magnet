-- Lead magnet schema. Run once in the Supabase SQL editor.
--
-- Safe to re-run: every statement is guarded.

create extension if not exists "pgcrypto";

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  magnet_slug         text        not null,
  email               text        not null,
  -- Answers to the magnet's own fields. Schemaless on purpose: every magnet
  -- asks different questions, and a column per question means a migration per
  -- landing page, which is exactly the friction this system exists to remove.
  fields              jsonb       not null default '{}'::jsonb,
  utm                 jsonb       not null default '{}'::jsonb,
  -- Salted hash, never the address itself.
  ip_hash             text,
  user_agent          text,
  referrer            text,
  email_sent_at       timestamptz,
  hubspot_contact_id  text,
  hubspot_synced_at   timestamptz,
  hubspot_error       text,
  created_at          timestamptz not null default now()
);

create index if not exists leads_magnet_created_idx on public.leads (magnet_slug, created_at desc);
create index if not exists leads_email_idx          on public.leads (email);
-- Supports the per-IP rate limit lookup in src/lib/leads.ts.
create index if not exists leads_ip_recent_idx      on public.leads (ip_hash, magnet_slug, created_at desc);
-- Finds leads whose HubSpot push failed, so they can be replayed.
create index if not exists leads_hubspot_pending_idx on public.leads (created_at desc)
  where hubspot_contact_id is null;

-- RLS on with no policies: the anon and authenticated keys can read nothing.
-- Only the service role key, which lives in the server environment and never
-- reaches a browser, can touch this table.
alter table public.leads enable row level security;

-- Private bucket for the magnet assets. Private is the default and the point:
-- the emailed link is a time-limited signature, so a forwarded link expires.
--
-- NOTE: current Supabase projects restrict direct writes to storage.buckets, so
-- this statement can fail with a row-level security error even in the SQL
-- editor. That failure is expected and harmless. If it happens, create the
-- bucket instead via Storage -> New bucket, named `magnets`, with Public OFF.
--
-- `pnpm run doctor` reports whether the bucket exists and whether it is private,
-- so there is no need to guess which path worked.
insert into storage.buckets (id, name, public)
values ('magnets', 'magnets', false)
on conflict (id) do nothing;
