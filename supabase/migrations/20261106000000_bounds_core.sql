-- Bounds core tables. Browsers read through the anon key; only the service role writes.
-- Robots are indexed by labelhash, never by ENS token ID, because token IDs can regenerate.

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  robot_label text not null,
  labelhash text not null check (labelhash ~ '^0x[0-9a-f]{64}$'),
  decided_at timestamptz not null default now(),
  kind text not null check (kind in ('CONTINUE', 'SLOW', 'STOP', 'UNREACHABLE')),
  reason text not null,
  request_id text,
  tee_verified boolean not null default false,
  model text
);
create index decisions_robot_time on public.decisions (labelhash, decided_at desc);
create index decisions_time on public.decisions (decided_at desc);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  robot_label text not null,
  labelhash text not null check (labelhash ~ '^0x[0-9a-f]{64}$'),
  started_at timestamptz not null,
  duration_sec integer not null check (duration_sec >= 0),
  decision_count integer not null check (decision_count >= 0),
  root_hash text not null unique check (root_hash ~ '^0x[0-9a-fA-F]{64}$'),
  tx_hash text check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  -- Storage sequence number. The 0G explorer links files by this, not by root hash.
  tx_seq bigint,
  created_at timestamptz not null default now()
);
create index episodes_robot_time on public.episodes (labelhash, started_at desc);

-- Filled by the external CRE script using the service role key.
create table public.cre_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null,
  workflow_name text not null,
  kind text not null check (kind in ('weather', 'zone', 'sanctions')),
  description text not null default '',
  run_at timestamptz not null default now(),
  result text not null check (result in ('no-action', 'fired', 'error')),
  revocation_tx text check (revocation_tx ~ '^0x[0-9a-fA-F]{64}$'),
  affected_labelhash text check (affected_labelhash ~ '^0x[0-9a-f]{64}$'),
  detail text
);
create index cre_runs_time on public.cre_runs (run_at desc);
create index cre_runs_tx on public.cre_runs (revocation_tx);

alter table public.decisions enable row level security;
alter table public.episodes enable row level security;
alter table public.cre_runs enable row level security;

-- No insert, update or delete policies: the service role bypasses RLS, everyone else is read-only.
create policy "public read" on public.decisions for select to anon, authenticated using (true);
create policy "public read" on public.episodes for select to anon, authenticated using (true);
create policy "public read" on public.cre_runs for select to anon, authenticated using (true);

create function public.decisions_per_hour(hours integer default 12)
returns table (bucket timestamptz, kind text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('hour', d.decided_at), d.kind, count(*)
  from public.decisions d
  where d.decided_at >= date_trunc('hour', now()) - make_interval(hours => least(hours, 168) - 1)
  group by 1, 2;
$$;

alter publication supabase_realtime add table public.decisions;
