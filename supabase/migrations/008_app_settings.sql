-- Migration 008: super-admin settings.
--
-- Two things Enrique asked for that had no home a human could edit:
--   1. The phone number Sol hands a call to when the guest asks for a supervisor or the front
--      desk. It lived only in the deploy environment (`TELNYX_TRANSFER_TARGET`, with `DEMO_PHONE`
--      as the fallback netlify/functions/tools/escalation.ts reads). An env var needs a redeploy;
--      a table row takes effect on the next call. The function reads the table FIRST and falls
--      back to the env vars, so nothing breaks before this migration runs.
--   2. Nothing new for staff/permissions — `profiles.role` (staff_role enum) already carries
--      them; the Settings page reads and updates it. Kill switches already exist (`demo_flags`,
--      surfaced on the "How it works" page); the Settings page links to and embeds them rather
--      than duplicating them.
--
-- Safe to run more than once.

create table if not exists app_settings (
  key         text primary key,
  value       text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

comment on table app_settings is
  'Super-admin editable settings. Rows are read by the runtime (e.g. supervisor_forward_phone) on every use; changes take effect without a redeploy.';

-- Seed with the env-configured value so the first save is a no-op until someone edits.
-- The INSERT is best-effort: if the value is not set here, the row simply starts NULL and the
-- function keeps falling back to the environment until it is.
insert into app_settings (key, value, updated_by)
values ('supervisor_forward_phone', null, 'migration 008')
on conflict (key) do nothing;

alter table app_settings enable row level security;

-- Any signed-in staff member may read (the transfer target is not a secret from staff; the
-- supervisor console shows related routing). Only an administrator may write.
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select using (auth.uid() is not null);

drop policy if exists settings_write on app_settings;
create policy settings_write on app_settings for all
  using (my_role() = 'admin') with check (my_role() = 'admin');
