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

1. ~~**Confirm "Receive SIP URI calls" is enabled.**~~ **Done and verified via the API on
   2026-09-24**: the connection reports `sip_uri_calling_preference: unrestricted`. Re-check only
   if the connection is ever recreated.
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
TOOL_WEBHOOK_SECRET
```

`TOOL_WEBHOOK_SECRET` must be **identical** in `.env` and in the Netlify environment. `/api/tools`
enforces it; provisioning reads it from `.env` and bakes it into the assistant's tool headers. If
the two ever diverge, every tool call Sol makes returns 401 and the model answers with nothing to
ground on. Change it in both places, then re-run `--refresh`.

### 5. After `agent/sol.md` changes

```bash
node scripts/telnyx/provision.mjs --refresh
```

Pushes recompiled instructions and the regenerated tool list onto the existing assistant. Does not
create anything new. This is the loop to use when tuning Sol's persona.

---

## How tools are registered

The 24 tools on the assistant are not all the same shape. Two dispatchers, two body shapes, one
auth header.

| Tools | URL | Body |
|---|---|---|
| 11 concierge + `classify_intent` | `POST /api/tools/<name>` | flat arguments, plus `call_control_id` |
| 11 group tools | `POST /api/group/tool` | `{ tool, args: {...}, call_control_id }` |
| `transfer_to_human` | native Telnyx `transfer` tool | not a webhook |
| `hangup` | native Telnyx `hangup` tool | not a webhook |

`netlify/functions/tools/registry.ts` mounts only `CONCIERGE_TOOLS` + `ROUTING_TOOLS`. A group
tool posted to `/api/tools/<name>` comes back **404 "Unknown tool"**, so group tools must go to
the group dispatcher, with the tool name pinned by a single-value `enum` so the model cannot
mis-address the call.

Every webhook tool carries two headers:

```
X-Solstice-Source: telnyx-assistant
x-solstice-tool-key: <TOOL_WEBHOOK_SECRET>
```

`/api/tools` returns **401** without the second one. `/api/group/tool` is currently open and
accepts it harmlessly, so securing the group dispatcher later needs no change here.

`--integration-secret` is an opt-in that stores the token in Telnyx
(`POST /v2/integration_secrets`, type `bearer`, identifier `solstice-tool-key`) and emits
`{{integration_secret.solstice-tool-key}}` as the header value instead of the literal. That keeps
the secret out of the assistant config, but whether a webhook tool header resolves that
placeholder is not documented anywhere we could verify, and if it does not resolve the result is
exactly the 401 outage this replaced. Default is the literal value, which is verifiable. Prove the
placeholder on a funded call before switching.

Note: `/v2/integration_secrets` is the real path. `/v2/ai/integration_secrets` 404s.

## Verification, in order

Do these in sequence. Each one isolates a different failure.

### V1 — the number reaches our webhook

Call `+13057866217`. In the Netlify function log for `telnyx` you should see, within a second:

```
[solstice] voice session opened {"session_id":"...","guest_id":"G100xx","phone":"+*******0148"}
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

### V2b — tool calls authenticate (the 401 regression)

Provisioning ends with a verification step that reads the assistant back and confirms
`x-solstice-tool-key` is on every webhook tool. It prints header names, never values. Expect:

```
[=] REUSED  tools on assistant — 24 total, 22 webhook
    11 -> https://<site>/api/tools/<name>
    11 -> https://<site>/api/group/tool
[=] REUSED  header x-solstice-tool-key — present on all 22 webhook tools
```

To confirm the stored value actually authenticates rather than merely being present, replay a call
with the header Telnyx holds:

```bash
curl -s -o /dev/null -w '%{http_code}
' -X POST "$PUBLIC_BASE_URL/api/tools/get_policy"   -H 'content-type: application/json' -d '{"topic":"cancellation"}'                    # expect 401
curl -s -o /dev/null -w '%{http_code}
' -X POST "$PUBLIC_BASE_URL/api/tools/get_policy"   -H 'content-type: application/json' -H "x-solstice-tool-key: $TOOL_WEBHOOK_SECRET"   -d '{"topic":"cancellation"}'                                                        # expect 200
```

Do **not** "fix" a 401 by unsetting `TOOL_WEBHOOK_SECRET`. The endpoint is deliberately open when
the variable is unset; unsetting it in production would leave the tool layer world-callable.

### V3 — caller identification

`sessions.guest_label` should read a real guest name for a phone in
`data/solstice-guest-profiles.csv` (they are stored as `312-555-0148`, matched on the last ten
digits), and `Unknown caller +*******1234` otherwise. `sessions.phone_masked` must never contain a
full number.

Masking comes from `netlify/functions/_lib/mask.ts`, the single source of truth for the whole
system, so the voice path cannot mask less than the data layer does. Separators are preserved and
only the last four digits survive, and `maskPhone` is idempotent, so a value that is masked twice
is unchanged rather than reduced to `+***********`.

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

### V5 — the supervisor ladder

**Status 2026-09-24: `supervise_call_control_id` against an `ai_assistant_start` leg WORKS.** The
leg was created successfully on the first live test. What failed was our own webhook, which
answered the supervisor leg and hung it up. Fixed; see "The supervisor-leg outage" below.

Retest in this order. The ordering matters: **the browser must be registered before anything is
dialled**, because the supervisor leg rings the browser, and if nothing is registered at that SIP
address there is nobody to answer.

1. **Deploy first.** The fix is code, not configuration. Nothing below is meaningful until the
   `telnyx` and `voice` functions are redeployed.
2. **Open the supervisor dashboard and confirm the browser registered.** It should call
   `POST /api/voice/credentials`, get a `login_token`, and register with `@telnyx/webrtc`. In the
   browser console the `TelnyxRTC` client must reach `registered` / `ready` before step 4.
   If it does not register, stop: the ladder cannot work and the fault is in the browser client,
   not the webhook.
3. **Call `+1 305 786 6217`** from a phone. Sol should answer and the session should appear live.
4. **Click Listen.** The browser should ring within a second or two. Answer it. You hear both
   sides; neither side hears you.
5. **Whisper**, then **Barge**, then **Take over**.

After step 4, check the session row:

```sql
select status, supervisor_call_control_id, supervisor_role from sessions where id = '<session>';
```

`supervisor_call_control_id` and `supervisor_role` are now written on every successful rung, so
the dashboard can show which rung is live. Before this fix they were null on every session.

**Reading a failure correctly.** In `tool_invocations` for that session:

| What you see | What it means |
|---|---|
| `supervisor.leg_opened` then `supervisor.leg_ended` ~2s later, with `voice.answer FAILED: 90018` in between | The old outage. Our webhook answered the supervisor leg. Should be impossible now. |
| `supervisor.leg_opened`, then `leg_ended` with NO `voice.answer` rows | The dial worked and our webhook stayed out of it. The browser did not answer: it was not registered, or "Receive SIP URI calls" is off. |
| `supervisor.leg_opened` and no `leg_ended` | The leg is up. If you hear nothing, it is an audio/registration issue, not a control-plane one. |

**If the leg itself is rejected** with "cannot supervise" / "invalid call state", fall back to the
conference shape documented in full at the top of `netlify/functions/voice/supervisor.ts`.

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

## The supervisor-leg outage (2026-09-24)

Worth reading before touching the webhook, because the failure looked exactly like a Telnyx
limitation and was not one.

Dialling the supervisor leg produces call events **on our own webhook**, twice: once for the
outbound leg on the call control application, and once for the inbound leg terminating on the
browser's Credential SIP Connection, whose `webhook_event_url` is also `/api/telnyx`.

The original guard checked `client_state.kind === 'supervisor'` and `direction === 'outgoing'`.
Neither survives on the leg that arrives at the credential connection: it has no `client_state`
of ours and its `direction` is `incoming`. So the webhook treated the supervisor's browser as a
brand new guest call, ran caller-ID identification against the SIP user, answered the leg, and
started Sol on it. Our own handler tore the supervisor down inside two seconds, which read as
"supervision does not work against an assistant leg".

The fix is in `netlify/functions/telnyx/_lib/legs.ts`: four independent signals, any one of which
proves a leg is not a guest (our `client_state` marker, the SIP connection id, a `to` addressed at
the supervisor SIP URI or username, and outbound direction), plus a **positive allowlist** for
guest calls: an inbound call addressed to the number we own, and nothing else, may create a
session. A denylist failed because it did not know about a leg shape it had never seen; an
allowlist fails closed on the next unfamiliar one.

`netlify/functions/telnyx/_lib/legs.test.ts` pins all of it, including the exact payload that
broke us, so this never needs a paid call to verify again.

## Verified configuration (2026-09-24)

Checked directly against the API, no phone call required:

- Credential SIP Connection `Solstice FDE - Supervisor WebRTC` (`3056182478436828555`) is active
  with `sip_uri_calling_preference: unrestricted`. **That is the "Receive SIP URI calls" toggle,
  and it is already on** — the manual portal step listed earlier is satisfied.
- Telephony credential `solstice-supervisor-webrtc` is attached to that connection
  (`resource_id: connection:3056182478436828555`; note Telnyx exposes it as `resource_id`, not
  `connection_id`), is not expired, and its `sip_username` matches `.env`.
- `POST /v2/telephony_credentials/{id}/token` returns HTTP 201 and a valid three-part JWT.
  **Lifetime is ~24 hours**, not the minutes that "short-lived" implies. The endpoint now reads
  `exp` off the token and returns the real `expires_at` / `expires_in_seconds` rather than a
  guess. The honest mitigation is that the token is scoped to one credential, carries no SIP
  password, and is revoked by deleting the credential.

What remains genuinely unverified is whether the browser client registers and answers, which
needs step 2 above.

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
