# Telnyx provisioning — run order and verification

Everything the voice path needs on the Telnyx side, in one idempotent script.
Re-running is safe: every resource is looked up by a stable name before it is created.

Owner: Agent A6. Files: `scripts/telnyx/**`, `netlify/functions/telnyx/**`, `netlify/functions/voice/**`.

---

## What exists after a successful run

| Resource | Name | Written to `.env` as |
|---|---|---|
| Call Control Application | `Solstice FDE - Sol Voice` | `TELNYX_CALL_CONTROL_APP_ID` |
| Phone number (reused) | `+13057866217` | `TELNYX_PHONE_NUMBER` |
| AI Assistant | `Sol` | `TELNYX_ASSISTANT_ID` |
| Credential SIP Connection | `Solstice FDE - Supervisor WebRTC` | `TELNYX_SIP_CONNECTION_ID` |
| WebRTC telephony credential | `solstice-supervisor-webrtc` | `TELNYX_TELEPHONY_CREDENTIAL_ID`, `TELNYX_SIP_USERNAME`, `TELNYX_SIP_PASSWORD`, `TELNYX_SIP_URI` |

`.env` is rewritten in place: existing keys keep their position, new keys are appended under a
marked section, and a `.env.bak` backup is written first. Nothing else in the file is touched.

---

## Run order

### 0. Prerequisites

- `TELNYX_API_KEY` in `.env`. Confirmed working against the funded account.
- Account balance above zero. Check without provisioning anything:

  ```bash
  node scripts/telnyx/provision.mjs --check
  ```

  One API call. Prints the available credit and stops.

- `agent/sol.md` should exist (Agent A3 owns it). If it does not, the script still runs and
  creates Sol with clearly-marked placeholder instructions, then tells you to re-run with
  `--refresh`.

### 1. Dry run first, always

```bash
node scripts/telnyx/provision.mjs --dry-run
```

Zero network calls. Parses `agent/sol.md` and `shared/toolContracts.ts`, prints the exact plan
including every webhook URL and the tool count. Read the tool count: it should equal the number of
entries in `shared/toolContracts.ts` (concierge + group + routing), with `transfer_to_human`
replaced by a native Telnyx transfer tool and a `hangup` tool added.

### 2. Provision

```bash
node scripts/telnyx/provision.mjs --base-url=https://<the-real-netlify-site>.netlify.app
```

`--base-url` matters: it is baked into the webhook URL on the Call Control Application and into
every tool's URL on the assistant. Get it wrong and Telnyx will POST call events into the void.
If you omit it, the script uses `PUBLIC_BASE_URL` from `.env`, then `URL`, then a guess.

The number is **reused, not purchased**. `+13057866217` is repointed from the retired JARVIS
connection onto the new Call Control Application. To buy a fresh number instead:

```bash
node scripts/telnyx/provision.mjs --buy --area-code=305
```

### 3. Two things only Enrique can do

1. **Telnyx portal -> SIP Connections -> `Solstice FDE - Supervisor WebRTC` -> confirm
   "Receive SIP URI calls" is ENABLED.** The script sets `sip_uri_calling_preference:
   "unrestricted"` via the API, which is the same switch, but confirm it visually. Without it the
   supervisor leg cannot reach the browser and listen / whisper / barge all fail with a dial error.
2. **Telnyx portal -> API Keys -> copy the Public Key into `TELNYX_PUBLIC_KEY` in `.env`.**
   Until it is set, `/api/telnyx` accepts unverified webhooks and logs
   `WEBHOOK SIGNATURE NOT VERIFIED` on every event. That is acceptable locally and unacceptable
   in production.

### 4. Mirror `.env` into Netlify

Netlify Functions read `process.env`, not the repo's `.env`. Copy these into
Site settings -> Environment variables, then redeploy:

```
TELNYX_API_KEY  TELNYX_PUBLIC_KEY  TELNYX_ASSISTANT_ID  TELNYX_PHONE_NUMBER
TELNYX_CALL_CONTROL_APP_ID  TELNYX_SIP_CONNECTION_ID  TELNYX_TELEPHONY_CREDENTIAL_ID
TELNYX_SIP_USERNAME  TELNYX_SIP_PASSWORD  TELNYX_SIP_URI  PUBLIC_BASE_URL
SUPABASE_URL  SUPABASE_ANON_KEY  SUPABASE_SERVICE_ROLE_KEY  DEMO_PHONE
```

### 5. After `agent/sol.md` changes

```bash
node scripts/telnyx/provision.mjs --refresh
```

Pushes recompiled instructions and the regenerated tool list onto the existing assistant. Does not
create anything new. This is the loop to use when tuning Sol's persona.

---

## Verification, in order

Do these in sequence. Each one isolates a different failure.

### V1 — the number reaches our webhook

Call `+13057866217`. In the Netlify function log for `telnyx` you should see, within a second:

```
[solstice] voice session opened {"session_id":"...","guest_id":"G100xx","phone":"(***) ***-0148"}
```

If nothing arrives: the number is still on the old connection, or `--base-url` was wrong.
Check `GET /v2/phone_numbers?filter[phone_number]=+13057866217` and compare `connection_id`
against `TELNYX_CALL_CONTROL_APP_ID`.

### V2 — Sol answers and the transcript is live

The call should be answered and Sol should greet you. Then, in Supabase:

```sql
select role, content, created_at from messages
where session_id = '<the session id from V1>' order by created_at;
```

Rows should appear **during** the call, one per conversation turn, not after it. This is the whole
demo beat. If the call connects but no rows appear, `ai_assistant_start` failed or
`send_message_history_updates` was dropped — check `tool_invocations` for
`voice.ai_assistant_start` and read its `result_summary`.

Reminder from `plans/02-voice-realtime.md`: the event is
`call.ai_gather.message_history_updated`, **not** `call.conversation.*`. Do not go looking in the
wrong namespace.

### V3 — caller identification

`sessions.guest_label` should read a real guest name for a phone in
`data/solstice-guest-profiles.csv` (they are stored as `312-555-0148`, matched on the last ten
digits), and `Unknown caller (***) ***-1234` otherwise. `sessions.phone_masked` must never contain
a full number.

### V4 — the browser supervisor can register

From the supervisor dashboard, with a `concierge` or `admin` session:

```js
const r = await fetch('/api/voice/credentials', {
  method: 'POST',
  headers: { Authorization: `Bearer ${supabaseAccessToken}` },
}).then((x) => x.json())
// r.login_token  -> new TelnyxRTC({ login_token: r.login_token })
// r.sip_uri      -> what the supervisor leg will be dialled at
```

A `group_sales` token must get **403**. That is the audio-path mirror of the RLS rule in
`supabase/schema.sql` that keeps Group Sales out of guest conversations.

### V5 — THE ONE THAT MUST BE TESTED FIRST: supervision of an assistant leg

**This is the riskiest assumption in the whole voice path.** Telnyx documents
`supervise_call_control_id` for ordinary Call Control legs, and documents `ai_assistant_start`.
It does not document whether supervision works against a leg that is currently running an AI
assistant. Mechanically it is an ordinary leg, so it should. Nothing confirms it either way.

Test it on the very first funded call, before building any demo choreography on top:

1. Call the number, let Sol answer.
2. With the browser registered (V4), `POST /api/voice/supervisor { session_id, action: "listen" }`.
3. The browser should ring. Answer it. You should hear both sides; neither side hears you.
4. `action: "whisper"` -> only Sol's side hears you. `action: "barge"` -> both do.
5. `action: "takeover"` -> Sol goes silent, the guest is still connected, you are audible.
   `sessions.status` becomes `taken_over` and a `supervisor` message row is written.

**If step 3 fails** with a "cannot supervise" / "invalid call state" error, switch to the
conference fallback. It is documented in full at the top of
`netlify/functions/voice/supervisor.ts` — assistant runs inside a conference, supervisor joins the
conference with `supervisor_role`. Conference + assistant is explicitly documented by Telnyx as a
real combination. The change is three call sites; the persisted state is identical.

### V6 — the archive closes cleanly

Hang up. Within a few seconds `sessions.ended_at` is set and `sessions.status` is `ended`
(or stays `taken_over` if a supervisor took the call — that distinction is deliberate).
`tool_invocations` should carry a `voice.conversation_ended` row, and, if an insight group was
attached, a `voice.conversation_insights` row.

---

## Endpoints this owns

| URL | Method | Purpose |
|---|---|---|
| `/api/telnyx` | POST | Inbound Telnyx webhook: answer, start Sol, stream transcript, archive |
| `/api/telnyx` | GET | Health probe; reports whether signature verification is enabled |
| `/api/voice/supervisor` | POST | `{ session_id, action: listen \| whisper \| barge \| takeover }` |
| `/api/voice/credentials` | POST | Short-lived `login_token` for `@telnyx/webrtc` |
| `/api/voice` | GET | Health probe |

`netlify.toml` already redirects `/api/*` to `/.netlify/functions/:splat`, and Netlify passes
trailing path segments to the matched function, which is how `voice/supervisor.ts` and
`voice/credentials.ts` get URLs without being separate functions. They cannot be separate
functions: Netlify treats a directory under `netlify/functions/` as one function whose entry point
is `index.ts`. That is why `netlify/functions/voice/index.ts` is a dispatcher.

We deliberately do **not** set `export const config = { path: ... }` on these functions. A v2 path
config can move a function off its default `/.netlify/functions/` URL, which would fight the
existing redirect in `netlify.toml`, and `netlify.toml` is not ours to edit.

---

## Known gaps

- **SMS is unregistered on this account** (zero messaging profiles, zero 10DLC brands). The code
  path is complete; do not attempt a live send. See `plans/03-messaging.md`.
- **`call.conversation_insights.generated` only fires if an insight group is attached.** The script
  attempts to create and attach one, and reports `SKIPPED` without failing if the endpoint shape
  has moved. Insights are archive polish, not a demo dependency.
- **The assistant model** defaults to `openai/gpt-4o`. Set `TELNYX_ASSISTANT_MODEL` in `.env` to
  change it; the script cross-checks against `GET /v2/ai/models` and prints the available ids if
  the configured one is not offered.
- **Webhook tool parameter shapes** in `provision.mjs` are this script's reading of
  `shared/types.ts`. The tools function owns the real request shape. If they diverge, fix the
  `TOOL_SPECS` map in `provision.mjs` and re-run with `--refresh`.
