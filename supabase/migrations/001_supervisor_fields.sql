-- Migration 001: supervisor call leg + post-call insights.
-- Requested by the voice integration: without these, the supervisor leg id and the
-- Telnyx insights payload have to ride inside tool_invocations, which muddies the trace.
-- Safe to run more than once.

alter table sessions add column if not exists supervisor_call_control_id text;
alter table sessions add column if not exists supervisor_role text
  check (supervisor_role in ('monitor', 'whisper', 'barge'));
alter table sessions add column if not exists insights jsonb;

comment on column sessions.supervisor_call_control_id is
  'Call Control id of the supervisor leg, set when a human clicks Listen. Null when no supervisor is attached.';
comment on column sessions.supervisor_role is
  'Current rung of the supervisor ladder. Takeover clears the AI rather than setting a role here.';
comment on column sessions.insights is
  'Payload from call.conversation_insights.generated, written after hangup.';
