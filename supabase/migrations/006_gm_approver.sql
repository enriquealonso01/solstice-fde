-- Migration 006: the general manager, the one role that approves group blocks (Policy 13).
--
-- The app does not wait for this. Until it runs, the gm login carries app_metadata.staff_role =
-- 'gm' (written by scripts/seed-users.mjs with the service key) and profiles.role =
-- 'group_sales', which is what lets it read the inbox. After it runs, profiles.role may be 'gm'.
--
-- my_role() is compared as text so this file also runs in one transaction: Postgres will not
-- cast to an enum value added earlier in the same transaction.

alter type staff_role add value if not exists 'gm';

drop policy if exists inq_read on inquiries;
create policy inq_read on inquiries for select using (my_role()::text in ('group_sales', 'gm', 'admin'));

drop policy if exists prop_read on proposals;
create policy prop_read on proposals for select using (my_role()::text in ('group_sales', 'gm', 'admin'));

drop policy if exists fup_read on follow_ups;
create policy fup_read on follow_ups for select using (my_role()::text in ('group_sales', 'gm', 'admin'));

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (my_role()::text in ('group_sales', 'gm', 'admin'));
