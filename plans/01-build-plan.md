# Solstice FDE — Build Plan

Built from plans/00-requirements.md. Decisions locked 2026-09-24.
Deadline: submit ~2026-09-27.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Platform | Supabase: Postgres + Auth + Realtime + Storage |
| D2 | Agent name | **Sol** |
| D3 | Judgment-case inquiry | INQ-2009 (Phoenix, 17% vs 15% ceiling), agent offers options |
| D4 | SMS | Pursue real SMS; registration started 2026-09-24 as a hedge |
| D5 | Frontend | Vite + React + TypeScript + Tailwind, single app, deployed to Netlify |
| D6 | Backend | Netlify Functions; all business logic in typed tools |
| D7 | Voice | Telnyx AI Assistant, one assistant, intent-routed concierge vs group |
| D8 | Email | Telnyx Email API (GA 2026-08-05); Resend documented as fallback |
| D9 | PDF | @react-pdf/renderer server-side, stored in Supabase Storage, signed URL |
| D10 | System map | React Flow, tabs per subsystem + zoom-out; .drawio exported for deliverable |

## D11 — NEEDS ENRIQUE'S CONFIRMATION: one agent definition, two runtimes

Voice and chat have different latency budgets, so they run on different engines:
- `agent/sol.md` is the SINGLE agent definition: persona, guardrails, routing, tool contracts
- Compiled into (a) the Telnyx assistant config for voice, (b) the Claude system prompt for chat
- BOTH call the same Netlify tool endpoints, so business logic can never diverge

Why not one runtime for both: Telnyx owns turn-taking and barge-in for voice, which we should not
rebuild. Chat on Claude streams directly, so we control typing indicators, tool-call chips, and
the "show everything it does" UI. Panel answer: one agent definition, two runtimes, one tool layer.

## Architecture

```
GUEST (public landing page)
  ├─ chat bubble ──> /api/chat (Claude, streaming) ──┐
  └─ phone number ─> Telnyx AI Assistant "Sol" ──────┤
                                                      ├─> shared tool layer (Netlify Functions)
STAFF (admin, 3 scoped logins)                        │      ├─ concierge tools
  ├─ Concierge Supervisor ─ live sessions, takeover   │      ├─ group booking rules engine
  ├─ Group Sales ─ inquiry inbox, proposals, side chat│      └─ delivery: Resend + Telnyx SMS
  └─ Super Admin ─ both + invites + BACKEND MAP       │
                                                      v
                                   Supabase: Postgres + Auth + Realtime + Storage
```

## Data model (Supabase)

- `profiles` — user, role: `concierge` | `group_sales` | `admin`
- `invites` — email, granted_role, status (super admin issues these)
- `sessions` — channel (voice|chat), guest identity, status (active|ended|taken_over), started_at
- `messages` — session_id, role, content, created_at (Realtime source for live transcript)
- `tool_invocations` — session_id, tool, args_masked, result_summary, latency_ms, grounded
- `escalations` — session_id, category, severity, context packet, status
- `inquiries` — the group requests, incl. ones created live by the voice agent
- `proposals` — inquiry_id, pricing, verdicts, pdf_path, status, sent_via, sent_at
- `audit_log` — who approved/overrode/sent what, when, and why
- Reference data seeded from the provided CSVs: `guests`, `reservations`, `properties`, `policies`

RLS enforces scoping: concierge role cannot read `inquiries`; group_sales cannot read `messages`.
Scoping is enforced in the DATABASE, not the UI. That is the answer when the panel asks.

## Guest side

1. **Landing page** — Solstice-branded, clean, typography-driven, no stock photo licensing.
   Displays the support phone number prominently.
2. **Chat bubble, bottom-right** — the centerpiece. Pristine UI:
   - Streaming responses, typing indicator
   - Tool-call chips ("checking your reservation", "reading cancellation policy") so the guest
     sees work happening and the panel sees the agent is not a black box
   - Policy citations rendered inline
   - Identity: guest gives a name or confirmation number; phone uses caller ID
3. **Voice** — same number on the page; Sol answers with the same persona and greeting.

## Admin: Login 1 — Concierge Supervisor

- Live session grid, updating via Supabase Realtime: channel, guest, duration, current intent
- Click a session: live transcript streaming + the tool trace alongside it
- **Take over** button — mechanism pending research (see plans/02-voice-realtime.md)
- Archive: every past chat and call, searchable, with full trace

## Admin: Login 2 — Group Sales

Inquiry inbox; each inquiry opens as a project view showing requirements, rule verdicts,
pricing, and the generated proposal.

Three demo paths:
1. **Auto-approvable + email present** -> "Accept and send" -> branded HTML email + PDF to Enrique
2. **Phone-only, created live by Sol during the demo** -> approve -> SMS + PDF link to Enrique
3. **INQ-2009, needs judgment** -> agent presents options with tradeoffs:
   - approve at the compliant 15%
   - escalate to GM for the requested 17%
   - counter at 16% with a value-add
   Rep picks; proposal regenerates; decision written to `audit_log`.

**Side chat on every inquiry** — an assistant scoped to that inquiry that can modify it, answer
questions, regenerate, send, or delete. Same tool layer, inquiry id bound into context.

Rules engine: thresholds live in `rules/` as data, never in the prompt. Seasonal caps buried in
the properties `notes` column (Denver ski weekends, Sacramento legislature weeks, Providence
overflow routing, Columbus youth insurance) are parsed into structured rules at build time.
Data validation quarantines SOL-PVD's `base_rate_suite = -395` instead of pricing off it.

## Admin: Login 3 — Super Admin

- Everything both scoped roles see
- Invite by email, grant/revoke roles
- **Backend page** — the technical presentation surface:
  - Zoom-out map of the entire system, pan and zoom
  - Tabs per subsystem: Guest channel, Voice, Agent + tools, Data, Delivery, Deploy
  - Every node names the real provider and why it was chosen over alternatives
  - Live health dots where cheap to wire
  - This is what Enrique narrates to the technical panel

## Deliverables owed to phData

- [ ] `agent/sol.md` — persona, prompts, tool definitions, guardrails, routing
- [ ] Sample transcripts exported to `transcripts/*.md`
- [ ] Architecture diagram: `.drawio` + rendered PNG (authored from the same model as the in-app map)
- [ ] Integration recommendation: PMS, CRS, loyalty/CRM, plus the front-desk-jobs answer
- [ ] Telnyx assistant JSON export
- [ ] Net-new tool, documented as such: `availability_service` (no inventory-by-date exists in
      the provided exports, so the agent would otherwise have to invent availability)
- [ ] README with the stated assumptions and the latency target and its justification

## Phasing (72h)

- **P0 Foundation**: repo, Netlify deploy, Supabase schema + RLS, seed CSVs, three logins
- **P1 Guest chat**: landing page, chat bubble, Claude streaming, tool layer, trace
- **P2 Voice**: Telnyx assistant, number, webhook tools, same persona, live transcript
- **P3 Group workflow**: rules engine, inbox, proposals, PDF, email, SMS, side chat
- **P4 Supervisor**: live sessions, transcript streaming, takeover
- **P5 Backend map + deliverables**: React Flow map, .drawio, integration write-up, transcripts

Cut order if time runs short: in-app live health dots, then takeover (degrade to listen-only),
then the interactive map (degrade to static .drawio).

## Research outcomes (2026-09-24)

- Live transcripts: SOLVED via send_message_history_updates -> call.ai_gather.message_history_updated
- Human takeover: SOLVED via supervisor leg + switch_supervisor_role + ai_assistant_stop, with the
  supervisor joining from the browser over WebRTC. See plans/02-voice-realtime.md
- SMS: cannot clear carrier registration before submission. Build it, default to email, switch to
  SMS if 10DLC clears before the panel. See plans/03-messaging.md
- Email: Telnyx Email API replaces Resend. One provider for voice, SMS, and email
