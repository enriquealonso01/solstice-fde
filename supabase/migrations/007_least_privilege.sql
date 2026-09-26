-- Migration 007: least privilege for staff reads, and raw inquiry contacts out of the payload.
-- Paste into the Supabase SQL editor. Safe to run more than once.
--
-- Every write in this app goes through the Netlify functions on the service role key, which
-- bypasses RLS. The browser only ever selects, and never from guests or reservations.

-- 1. Guests and reservations: concierge and admin only. reservations.data carries payment_last4;
--    group sales quotes from properties and inquiries and reads neither table.
drop policy if exists ref_guest on guests;
create policy ref_guest on guests for select using (my_role() in ('concierge','admin'));

drop policy if exists ref_resv on reservations;
create policy ref_resv on reservations for select using (my_role() in ('concierge','admin'));

-- 2. Audit rows: no insert policy, so only the service role writes them. Reads are unchanged.
drop policy if exists audit_ins on audit_log;

-- 3. Raw inquiry contacts: RLS on and no policies, so only the service role reads them.
create table if not exists inquiry_contacts (
  inquiry_code text primary key references inquiries(inquiry_code) on delete cascade,
  email        text,
  phone        text,
  created_at   timestamptz not null default now()
);
alter table inquiry_contacts enable row level security;
revoke all on inquiry_contacts from anon, authenticated;

-- Copy the raw values out of payload. A re-run fills in what is new and never blanks a stored value.
insert into inquiry_contacts (inquiry_code, email, phone)
select inquiry_code,
       case when payload->>'contact_email' not like '%*%' then nullif(payload->>'contact_email', '') end,
       case when payload->>'contact_phone' not like '%*%' then nullif(payload->>'contact_phone', '') end
from inquiries
where payload->>'contact_email' not like '%*%' or payload->>'contact_phone' not like '%*%'
on conflict (inquiry_code) do update
  set email = coalesce(excluded.email, inquiry_contacts.email),
      phone = coalesce(excluded.phone, inquiry_contacts.phone);

-- Then replace each raw value in payload with its masked twin, which is what the app writes and
-- what the inbox renders.
update inquiries
set payload = jsonb_set(payload, '{contact_email}', coalesce(payload->'contact_email_masked', 'null'::jsonb))
where payload->>'contact_email' not like '%*%';

update inquiries
set payload = jsonb_set(payload, '{contact_phone}', coalesce(payload->'contact_phone_masked', 'null'::jsonb))
where payload->>'contact_phone' not like '%*%';
