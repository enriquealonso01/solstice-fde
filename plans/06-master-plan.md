# Master plan: the whole picture

Single source of truth for the phData FDE challenge. Verified against the live system on
2026-09-25, not written from memory.

- **Live:** https://solstice-hotel-group.netlify.app · **Phone:** +1 (305) 786-6217
- **Repo:** 187 tracked files, 111 TypeScript files, 308 tests passing
- **Telnyx balance:** $3.63 — enough for a few rehearsal calls, not a long panel demo

---

## 1. What exists, verified

### Live and responding

| Surface | State |
|---|---|
| Landing page + chat bubble | 200 |
| `/login`, three scoped roles | 200 |
| `/api/tools/<name>` | 200 with secret, 401 without |
| `/api/group/*` | 200 for staff, 401 anonymous, 403 for the wrong role |
| `/api/cost` | 401 anonymous, admin only |
| `/api/voice/*` | 200 |
| Telnyx assistant "Sol" | 25 tools, Claude Haiku 4.5, Azure Ava HD voice |

### Real data in Postgres

10 properties · 24 guests · 25 reservations · 15 policy sections · 11 inquiries · 7 proposals ·
3 follow-ups · 29 sessions · 122 messages · 147 tool invocations · 5 escalations · 211 audit rows ·
3 staff accounts.

None of this is seeded theatre except the reference data: the sessions, messages, escalations and
audit rows are from real conversations.

### Capabilities

- **Concierge agent** on chat and telephone, one agent definition compiled to both runtimes
- **Group workflow**: all ten inquiries produce correct verdicts, proposals with real PDFs,
  approval gate that refuses on every path including the agent's own send tool
- **Follow-ups**: draft, approve, send, with the same gate
- **Proposal editing**: prose only; numbers stay derived from the rules engine
- **Three scoped dashboards** with RLS enforced in Postgres, proven by role
- **Supervisor ladder**: listen, whisper, barge, take over — built, browser client registered
- **Backend map**: 7 tabs, real provider names, narration notes
- **Cost page**: measured spend, per-conversation cost, projection to 140 properties
- **Email delivery**: proven end to end
- **One-question-at-a-time group intake**, email first, inquiry opened on the first answer

### Deliverables on disk

| Brief asks for | File |
|---|---|
| Agent configuration | `agent/sol.md` |
| Sample transcripts | `transcripts/` — 4 chat + 1 real phone call |
| Architecture diagram | `docs/architecture.drawio` (3 pages), `docs/architecture.svg` |
| Integration recommendation | `docs/integration-recommendation.md` |
| Latency target and justification | `docs/latency-target.md` |
| Native platform export | `exports/telnyx-assistant.json` |
| How this was built with agents | `docs/how-this-was-built.md` |
| Front door | `README.md` |
| Demo cheat sheet | `docs/demo-cheatsheet.md` |

---

## 2. What is left

### Blocked on Enrique

| # | Item | Why it matters | What is needed |
|---|---|---|---|
| E1 | Verify the supervisor ladder live | Headline demo moment, never once worked end to end | One call while watching the dashboard |
| E2 | Confirm the proposal email arrived | Proven sent, not proven received | Check `enrique@provensolved.com` |
| E3 | Top up Telnyx | $3.63 will not survive rehearsal plus a panel demo | ~$30 |
| E4 | 10DLC registration | SMS demo beat | Start it; days of carrier queue |
| E5 | Decide the submission moment | Deadline was ~72h from 2026-09-24 | Send to kdesotell@phdata.io |

### Mine, no dependencies

| # | Item | Value | Est. |
|---|---|---|---|
| M1 | Live failure-injection toggle | The strongest unbuilt "surprise and delight": flip the PMS off mid-demo, watch it degrade honestly | 1-2h |
| M2 | Future-capabilities roadmap in business outcomes | Katie's email asks for the vision, not just the MVP | 45m |
| M3 | Demo runbook: the exact narrative, beat by beat | D1 and D3 both hinge on a rehearsed story | 1h |
| M4 | Rehearsable live modification, documented | They will ask you to change something on the spot | 30m |
| M5 | Make live-service tests hermetic | A flaky run during a technical deep-dive undercuts everything | 45m |
| M6 | Clean phantom sessions from the supervisor grid | Old supervisor-leg bug left empty sessions that look like junk on screen | 20m |
| M7 | Submission package: what actually gets sent, and how | Nobody has decided whether this is a repo link, a zip, or both | 30m |

---

## 3. Gaps nobody has named yet

Things that are not on any list but would be noticed.

1. **No one has walked the whole app as a stranger.** Every screen has been checked in isolation.
2. **The landing page has never been reviewed on a phone.** A panel may open it on mobile.
3. **`DEMO_LOGINS.md` is gitignored**, correct for the repo, but the panel needs credentials. The
   submission needs a decision about how they get them.
4. **No error path has been demoed deliberately.** We know it degrades; nobody has shown it.
5. **The chat bubble's mic has never been used.** Browser voice is built and unverified.
6. **Nothing states what this cost to build.** The cost page shows runtime cost; the build itself
   is a stronger number for an FDE pitch.
7. **The 72-hour clock.** Received 2026-09-24. If that is strict, submission is due imminently, and
   nothing in these plans says who decides that.

---

## 4. Order of work

1. M3 demo runbook — forces every other gap into the open
2. M1 failure injection — highest demo value remaining
3. M2 roadmap, M4 live modification — both needed for the panel conversation
4. M6, M5 — polish and reliability
5. M7 submission package — last, once content is stable

Blocked items stay blocked; they are listed so they are not forgotten, not so they stall the rest.
