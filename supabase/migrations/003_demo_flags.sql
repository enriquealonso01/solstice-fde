-- Migration 003: runtime failure injection.
--
-- The brief asks how the system degrades when something upstream fails. A diagram can assert it;
-- this lets us show it. An administrator flips a dependency off mid-conversation and the agent
-- stops confirming what it can no longer verify, says so plainly, and escalates.
--
-- Deliberately in Postgres rather than an environment variable: an env var needs a redeploy, and
-- a demo beat that takes 90 seconds to take effect is not a demo beat.
-- Safe to run more than once.

create table if not exists demo_flags (
  key         text primary key,
  enabled     boolean not null default false,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

comment on table demo_flags is
  'Runtime switches for demonstrating failure modes. Never used for real feature gating.';

insert into demo_flags (key, note) values
  ('pms_offline',      'Property management system unreachable: no live availability, no same-day inventory.'),
  ('reservations_offline', 'Central reservations unreachable: existing bookings cannot be read.'),
  ('policy_source_offline', 'Policy reference unreachable: the agent cannot cite a policy.')
on conflict (key) do nothing;

alter table demo_flags enable row level security;

-- Any signed-in staff member may SEE what is switched off, because it changes what the agent can
-- answer and the supervisor needs to know why. Only an administrator may flip one.
drop policy if exists flags_read on demo_flags;
create policy flags_read on demo_flags for select using (auth.uid() is not null);

drop policy if exists flags_write on demo_flags;
create policy flags_write on demo_flags for all using (my_role() = 'admin') with check (my_role() = 'admin');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'demo_flags'
  ) then
    alter publication supabase_realtime add table demo_flags;
  end if;
end
$$;
