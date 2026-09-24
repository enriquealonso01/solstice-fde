-- Migration 002: follow-ups.
-- A follow-up is the message we send when an inquiry is missing information, and it gets the
-- same discipline as a proposal: drafted, reviewed, approved, then sent, with an audit trail.
-- Safe to run more than once.

create table if not exists follow_ups (
  id             uuid primary key default gen_random_uuid(),
  inquiry_id     uuid not null references inquiries(id) on delete cascade,
  follow_up_code text unique not null,
  channel        text not null check (channel in ('email','sms','needs_human')),
  subject        text,
  body           text not null,
  missing_fields text[] not null default '{}',
  status         text not null default 'draft'
                 check (status in ('draft','approved','sent','discarded','needs_human')),
  approved_by    text,
  approved_at    timestamptz,
  sent_to        text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists follow_ups_inquiry_created_idx on follow_ups (inquiry_id, created_at);

alter table follow_ups enable row level security;

drop policy if exists fup_read on follow_ups;
create policy fup_read on follow_ups for select using (my_role() in ('group_sales','admin'));

drop policy if exists fup_write on follow_ups;
create policy fup_write on follow_ups for all using (my_role() in ('group_sales','admin'))
  with check (my_role() in ('group_sales','admin'));

-- Idempotent: adding a table already in the publication raises, so check first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follow_ups'
  ) then
    alter publication supabase_realtime add table follow_ups;
  end if;
end
$$;
