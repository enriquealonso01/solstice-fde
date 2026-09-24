-- Solstice FDE schema. Role scoping is enforced HERE, in the database, not in the UI.
-- That is the answer when the panel asks how you know a sales rep cannot read guest calls.

create type staff_role as enum ('concierge', 'group_sales', 'admin');

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null unique,
  full_name   text,
  role        staff_role not null default 'concierge',
  created_at  timestamptz not null default now()
);

create table invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  granted_role staff_role not null,
  invited_by   uuid references profiles(id),
  status       text not null default 'pending',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- conversations

create table sessions (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (channel in ('voice','chat')),
  guest_id       text,
  guest_label    text,
  phone_masked   text,
  status         text not null default 'active' check (status in ('active','ended','taken_over')),
  intent         text,
  call_control_id text,
  telnyx_conversation_id text,
  supervisor_call_control_id text,
  supervisor_role text check (supervisor_role in ('monitor','whisper','barge')),
  insights jsonb,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  role        text not null check (role in ('user','assistant','system','supervisor')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index on messages (session_id, created_at);

create table tool_invocations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references sessions(id) on delete cascade,
  tool            text not null,
  args_masked     jsonb not null default '{}',
  result_summary  text,
  grounded        boolean,
  latency_ms      integer,
  created_at      timestamptz not null default now()
);
create index on tool_invocations (session_id, created_at);

create table escalations (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid references sessions(id) on delete set null,
  category           text not null,
  severity           text not null default 'normal',
  summary            text not null,
  packet             jsonb not null,
  status             text not null default 'open',
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- group sales

create table inquiries (
  id             uuid primary key default gen_random_uuid(),
  inquiry_code   text unique not null,
  source         text not null default 'portal' check (source in ('portal','voice','manual')),
  payload        jsonb not null,
  missing_fields text[] not null default '{}',
  status         text not null default 'new',
  created_at     timestamptz not null default now()
);

create table proposals (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  uuid not null references inquiries(id) on delete cascade,
  status      text not null default 'draft'
              check (status in ('draft','awaiting_approval','approved','sent','rejected')),
  verdicts    jsonb not null default '[]',
  pricing     jsonb not null default '{}',
  pdf_path    text,
  sent_via    text check (sent_via in ('email','sms')),
  sent_to     text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor       uuid references profiles(id),
  action      text not null,
  subject     text not null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- reference data

create table properties   (property_code text primary key, data jsonb not null);
create table guests       (guest_id text primary key, data jsonb not null);
create table reservations (reservation_id text primary key, guest_id text, data jsonb not null);
create table policies     (section_id text primary key, title text not null, body text not null);

-- ---------------------------------------------------------------- RLS

alter table profiles         enable row level security;
alter table invites          enable row level security;
alter table sessions         enable row level security;
alter table messages         enable row level security;
alter table tool_invocations enable row level security;
alter table escalations      enable row level security;
alter table inquiries        enable row level security;
alter table proposals        enable row level security;
alter table audit_log        enable row level security;
alter table properties       enable row level security;
alter table guests           enable row level security;
alter table reservations     enable row level security;
alter table policies         enable row level security;

create or replace function my_role() returns staff_role
language sql stable security definer set search_path = public as $fn$
  select role from profiles where id = auth.uid()
$fn$;

-- Everyone signed in sees their own profile; admins see all.
create policy profiles_self on profiles for select using (id = auth.uid() or my_role() = 'admin');
create policy profiles_admin_write on profiles for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy invites_admin on invites for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- Conversation surface: concierge + admin only. group_sales is deliberately excluded.
create policy sessions_read on sessions for select using (my_role() in ('concierge','admin'));
create policy messages_read on messages for select using (my_role() in ('concierge','admin'));
create policy tools_read    on tool_invocations for select using (my_role() in ('concierge','admin'));
create policy esc_read      on escalations for select using (my_role() in ('concierge','admin'));
create policy esc_write     on escalations for update using (my_role() in ('concierge','admin'));

-- Group sales surface: group_sales + admin only. concierge is deliberately excluded.
create policy inq_read   on inquiries for select using (my_role() in ('group_sales','admin'));
create policy inq_write  on inquiries for all    using (my_role() in ('group_sales','admin')) with check (my_role() in ('group_sales','admin'));
create policy prop_read  on proposals for select using (my_role() in ('group_sales','admin'));
create policy prop_write on proposals for all    using (my_role() in ('group_sales','admin')) with check (my_role() in ('group_sales','admin'));
create policy audit_read on audit_log for select using (my_role() in ('group_sales','admin'));
create policy audit_ins  on audit_log for insert with check (auth.uid() is not null);

-- Reference data is readable by any signed-in staff member; writes go through service role.
create policy ref_props on properties   for select using (auth.uid() is not null);
create policy ref_guest on guests       for select using (auth.uid() is not null);
create policy ref_resv  on reservations for select using (auth.uid() is not null);
create policy ref_pol   on policies     for select using (auth.uid() is not null);

-- Live dashboard feeds
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table tool_invocations;
alter publication supabase_realtime add table escalations;
alter publication supabase_realtime add table inquiries;
alter publication supabase_realtime add table proposals;
