# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 158 — 2026-09-26 ~01:10 EST

**The plan is accurate and correctly ordered.** This iteration was spent verifying, not planning.

### Verified: the agent-config chain, all the way to the live assistant

Nobody had rechecked this since the Tester's iteration 36, ten hours and several re-provisions ago.

```
agent/sol.md --compileInstructions--> 29,655 chars
exports/telnyx-assistant.json         29,655   identical: true
GET /v2/ai/assistants/assistant-fee8...  HTTP 200
  instructions 29,655  MATCH: true | tools 25/25 MATCH: true
  greeting MATCH: true | model anthropic/claude-haiku-4-5 == export
```

**Three artifacts byte-identical, one fetched live from Telnyx.** The 25 tools include the native
`transfer` and `hangup` that exist only on the voice runtime. This is the claim to make in the room and
it is now measured.

### Verified: the export is clean, and it confirmed T34's cost directly

Every `.env` value of 8+ chars checked against the committed export. `TELNYX_SIP_USERNAME`,
`TELNYX_SIP_PASSWORD`, `TOOL_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `TELNYX_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `DEMO_PHONE` — **all absent.** Markers present:
`REDACTED_INJECTED_FROM_TOOL_WEBHOOK_SECRET`, `REDACTED_TRANSFER_TARGET`. `llm_api_key_ref: null`.

**And the live transfer target is `sip:<TELNYX_SIP_USERNAME>@sip.telnyx.com`** — the exposed username
**is** the front-desk transfer target, compared without printing either. So *"rotating kills the
transfer target"* is a measurement now, not an inference. **Option 1, accept and rotate after the demo,
is right.**

*My first sweep said "5 LEAKS" — all false: assistant id, public URL, model name, voice name,
`SOL_THINKING`. A leak test that treats any env value as a secret finds the env file, not a leak.*

### Filed T46: `.env.example` ships the configuration we rejected — one line

`README.md` step 2 is `cp .env.example .env`. **`.env.example:43` leaves `SOL_THINKING` blank**, and
`chat.ts:67` reads blank as **`adaptive`**. `docs/latency-target.md:125` says `disabled` is set in
production and was chosen because it is *"the only configuration that produced zero behavioural
violations"* — with adaptive on, *"Sol created a real escalation and then failed to tell the guest."*

**So a reviewer following our own instructions runs the build we rejected, and the failure they could
hit is the exact guardrail `transcripts/honest-handoff.md` is offered as proof of** — the first
transcript we tell them to read. The comment calls it a *"Latency dial"*, which the latency doc
overturns: the choice is about behaviour and the price is latency.

**What I could NOT verify, and it is the more important half:** whether the deploy really has
`SOL_THINKING=disabled`. `/api/flags` is 401 anon; `tool_invocations` returns zero rows to the anon key
(RLS); reading Netlify env needs the CLI, which is lock-and-deploy work. **Two checks settle it:**
`npx netlify env:get SOL_THINKING`, or one `turn_metrics` row with the service-role key —
`args_masked.thinking` is literally `'disabled'` or `'adaptive'`, and my three live turns at 00:45 wrote
rows. **If production is `adaptive`, T46 becomes a deliverable contradicting the running system.
T46 says check before you edit.**

### Deliverable sweep: everything the brief names exists

Diagram (SVG 66KB + drawio 123KB), diagram README, integration recommendation, latency target, native
export, agent config, **six transcripts plus README** (five chat, one real call). Every path cited in
`SUBMISSION.md` resolves.

**One judgment call, stated not filed:** `transcripts/refund-outside-window.md` is still named for the
framing T42 fixed in its H1. `transcripts/README.md:13` describes it correctly, so **only the filename
carries the old framing and nothing a reader clicks does.** Renaming touches three documents nine hours
out. **Leave it.**

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3** — `HUMAN_INTERVENTION.md:63`, SQL at **596** | Enrique |
| 2 | **Top up Telnyx** — under $4 and falling; portal.telnyx.com, Billing, ~$30 | Enrique |
| 3 | **T21** — delete `INQ-2012`/`INQ-2013`, cascade count first | Enrique |
| 4 | **T34** — accept. Now measured: the exposed username **is** the live transfer target | Enrique |
| T44 | One clause: first `npx netlify` run installs the CLI | **CLAIMED It118** |
| T46 | One line in `.env.example`. **Verify production first** | any agent |

**Tester silent 4h44m** — last write 2026-09-25 20:26:34 EDT, against a 20-minute threshold. The
659-test guard suite is green, so the documents are held; what is missing is a second pair of eyes on
live production. Inbox empty. No lock held.

### The single most important remaining item

**The `drop policy` paste.** Still the only open item with a live security consequence, still three
lines, re-proved open at 00:47 with a probe that wrote nothing.
