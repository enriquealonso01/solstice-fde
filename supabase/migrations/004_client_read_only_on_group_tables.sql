-- Take client-side write access off the group tables.
--
-- WHY. `canSend` (netlify/functions/group/store.ts:464) is the single authority on whether a
-- proposal may leave the building, and it short-circuits on the row's own status:
--
--     if (proposal.status === 'approved') {
--       return { allowed: true, human_reason: `This proposal was outside our own authority, and
--         ${proposal.approved_by ?? 'an authorised approver'} approved it…` }
--     }
--
-- The original policy set granted `group_sales` FOR ALL on proposals, so a signed-in rep could
-- PATCH that status themselves, from the browser, with nothing but the public anon key:
--
--     PATCH /rest/v1/proposals?id=eq.<row>   {"status":"approved"}   -> HTTP 200, row returned
--     PATCH /rest/v1/proposals?id=eq.<row>   {"status":"sent","sent_at":"…"} -> HTTP 200
--
-- Verified live against production on 2026-09-25 as sales@solsticehotels.com. That turns the
-- approval gate into a suggestion: the rep who is only authorised to *request* GM sign-off can
-- grant it to themselves, and `approved_by` stays null, so the gate then tells the next person that
-- "an authorised approver" approved it when nobody did. The same policy let a rep rewrite an
-- inquiry's status.
--
-- WHY DROPPING IS SAFE. Nothing in the client writes these tables. Every write goes through the
-- Netlify functions with the service role key, which bypasses RLS. The only client-side writes in
-- the whole front end are `invites` and `profiles` on the staff admin screen
-- (src/pages/admin/AdminHome.tsx:223,252); `useAdminData.ts` only ever calls `.select(...)`, and
-- `patchProposal` is local React state, not a database write. So reads keep working, the functions
-- keep working, and the browser loses a capability it never used.
--
-- audit_log already had this shape and was already safe: it has insert and select policies and no
-- update or delete policy, so `DELETE /rest/v1/audit_log?action=eq.proposal.send_blocked` as the
-- same rep removed 0 rows. This migration brings the group tables into line with it.

drop policy if exists prop_write on proposals;
drop policy if exists inq_write  on inquiries;
drop policy if exists fup_write  on follow_ups;

-- Reads are unchanged and stay role-scoped; they are restated here only so applying this file to a
-- fresh database leaves the group surface readable.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'proposals' and policyname = 'prop_read') then
    create policy prop_read on proposals for select using (my_role() in ('group_sales','admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inquiries' and policyname = 'inq_read') then
    create policy inq_read on inquiries for select using (my_role() in ('group_sales','admin'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'follow_ups' and policyname = 'fup_read') then
    create policy fup_read on follow_ups for select using (my_role() in ('group_sales','admin'));
  end if;
end $$;
