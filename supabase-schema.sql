-- Run this SQL in Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  track jsonb not null,
  requester text not null default 'Anónimo',
  played boolean not null default false,
  created_at timestamptz not null default now(),
  spotify_sync_status text not null default 'pending' check (spotify_sync_status in ('pending','syncing','synced','failed')),
  spotify_sync_error text,
  idempotency_key text unique
);
create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists requests_sync_status_idx on public.requests (spotify_sync_status) where spotify_sync_status in ('pending','failed');

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- API access uses only the service-role key on the server. Do not expose it in browser code.
alter table public.requests enable row level security;
alter table public.app_settings enable row level security;
