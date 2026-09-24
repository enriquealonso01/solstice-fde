# Requirements audit: what the brief asked for, what exists, what is left

Written 2026-09-24 against the challenge PDF and Katie's email. The point of this file is to stop
drift: everything below is either a stated requirement or a stated evaluation criterion. Anything
not on this list is optional polish, however good it looks.

Legend: **DONE** verified working · **PARTIAL** exists, not finished or not verified · **MISSING**

---

## A. The three things the brief says to build

| # | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | Guest and Staff Concierge Agent, conversational, grounded in the provided data | **DONE** | Live on chat and on +1 305 786 6217. Refuses ungrounded answers, cites policy sections |
| A2 | Knows what it cannot do and escalates with full context | **DONE** | Escalation packet with reservation, rate plan, policy citations, attempted resolutions. 4 escalations recorded |
| A3 | Group Booking Workflow, agentic: gather, check availability and rates, apply rules, generate proposal or flag | **DONE** | All 10 inquiries produce correct verdicts; proposals with PDFs; approval gate |
| A4 | Custom fit-for-purpose UI, not a Claude or ChatGPT window | **DONE** | Hotel landing page with chat bubble, plus three scoped staff dashboards |
| A5 | At least one net-new tool not handed to us in the data | **DONE** | `availability_service`, plus `check_comp_authority`. Documented as assumptions |

## B. Requirements and guardrails, as listed

| # | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | Resolve most routine questions without a human | **DONE** | Policy, reservation, tier, late checkout, amenities all self-serve |
| B2 | Handoff carries full context, not a restart | **DONE** | Escalation packet schema |
| B3 | Never invent a policy, rate or availability | **DONE** | `grounded: false` forces escalation; parking refusal is the demo case |
| B4 | Group proposals outside the rules are flagged, never auto-approved | **DONE** | `canSend` gate refuses on every path including the agent's own send tool |
| B5 | Guest PII, especially payment, never unmasked | **DONE** | Masked at the data layer, enforced in tests, card digits never returned to the model |
| B6 | Set a latency target and justify it | **DONE** | `docs/latency-target.md`: measured, missed the first target, explains why and what we traded |

## C. What else the brief asks for

| # | Requirement | Status | Gap |
|---|---|---|---|
| C1 | Architecture diagram, future-state production | **DONE** | `docs/architecture.drawio` (3 pages) + `.svg` |
| C2 | Diagram shows data provenance, where the agent runs, monitoring, graceful degradation | **DONE** | Dedicated degradation page with 6 numbered paths |
| C3 | Short integration recommendation, PMS / CRS / loyalty | **DONE** | `docs/integration-recommendation.md` |
| C4 | The "is the AI coming for our jobs" answer | **DONE** | Same file, grounded in Policy 6 admitting its own limit |
| C5 | Source code and agent configuration `.md` | **DONE** | `agent/sol.md`, 19-row guardrail table |
| C6 | A few sample transcripts | **PARTIAL** | 4 captured, all CHAT. No voice transcript exported, and they predate the latest prompt changes |
| C7 | Native export from the platform of choice (.zip, .json) | **DONE** | `exports/telnyx-assistant.json`, 25 tools, secret redacted, regenerate with `npm run telnyx:export` |
| C8 | Be ready to open the hood and change something live | **PARTIAL** | The path exists (`thresholds.ts`, one line, re-runs) but has never been rehearsed |

## D. What Katie's email adds, which the PDF does not

| # | Criterion | Status | Gap |
|---|---|---|---|
| D1 | Explain clearly to BOTH technical and non-technical stakeholders | **PARTIAL** | Backend map for technical, cost page for commercial. No rehearsed narrative tying them together |
| D2 | Handle ambiguity well | **DONE** | 7 stated assumptions in the README; INQ-2010 blackout catch; the phantom Boston property |
| D3 | Modify or explain parts live, under questioning | **PARTIAL** | Same as C8. Needs one rehearsed, known-safe live edit |
| D4 | Demonstrate leveraging AGENTS to build MVP software | **DONE** | `docs/how-this-was-built.md`: the six-agent setup, the five cross-agent bugs they caught, where they were wrong and a human decided |
| D5 | Surprise and delight | **PARTIAL** | Have: live phone call, the -395 quarantine, the blackout their own fixture missed, the cost page. Missing: the live failure-injection demo, and the supervisor takeover is built but unverified |
| D6 | Speak to FUTURE capabilities, sell the vision not just the MVP | **PARTIAL** | Future state is in the diagram, but there is no roadmap framed in business outcomes |

---

## E. Known risks, honestly

| Risk | Detail |
|---|---|
| Supervisor takeover unverified | The browser SIP client was only just built. Two live attempts failed for different reasons, both fixed, never retested. It is a headline moment that may not work |
| Email send never completed end to end | RESOLVED 2026-09-24. PRP-2006 sent successfully. Four fixes needed: TELNYX_EMAIL_FROM unset, shared domain requires onboarding@msgtelnyx.com, sandbox only delivers to the account's verified address, and our payload used html/text instead of html_body/text_body |
| Follow-ups never exercised | Table exists, zero rows. Generate, approve, send has not been run once |
| SMS blocked | 10DLC registration not started on the funded account. Will not clear for submission; may clear before the panel |
| Some tests touch live Supabase | A run showed 8 failures then 0 with unchanged code. Flaky tests in front of a panel are a bad look |
| Conversation thread untested | Endpoint and UI both shipped, never verified together |

---

## F. What to do, in priority order

**P0, required for the submission itself**
1. Export the Telnyx assistant to a committed JSON file (C7)
2. Prove one proposal email actually arrives (E)
3. Recapture transcripts against the current prompt, and export one VOICE transcript (C6)
4. Write the "how this was built with agents" section (D4)

**P1, wins the panel**
5. Verify the supervisor ladder on a real call (E, D5)
6. Live failure-injection toggle: flip the PMS off mid-demo and show honest degradation (D5)
7. A future-capabilities section framed as business outcomes, not features (D6)
8. Rehearse one live modification, end to end, and one live explanation of it (C8, D3)

**P2, only if time**
9. Follow-up generate to send, once, for real
10. SMS if 10DLC clears
11. Make the live-service tests hermetic
