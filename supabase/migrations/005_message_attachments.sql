-- A supervisor can hand a guest a file mid-conversation: a booking confirmation, a parking permit,
-- a floor plan. The file itself lives in the public `attachments` Storage bucket behind an
-- unguessable path (netlify/functions/supervisor/attachments.ts). This column holds what the two
-- renderers need in order to show it: the guest widget and the admin transcript.
--
-- Nullable, and every reader treats absence as "a plain text message", so this migration is safe to
-- apply to a live database with a conversation in progress. The send path also survives the column
-- NOT existing -- it falls back to putting the URL in the message text -- so applying this improves
-- how an attachment renders rather than deciding whether one can be sent at all.
--
-- Shape: { "filename": "permit.pdf", "content_type": "application/pdf", "bytes": 84213,
--          "url": "https://.../attachments/<session>/<random>/permit.pdf", "host": "storage" }

alter table messages add column if not exists attachment jsonb;

-- Partial, because the overwhelming majority of messages have no attachment and an index over 300k
-- nulls to find a handful of rows is the wrong trade.
create index if not exists messages_with_attachment
  on messages (session_id, created_at)
  where attachment is not null;
