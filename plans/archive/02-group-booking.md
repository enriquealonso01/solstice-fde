# Part 2 Plan: Group Booking Workflow (agentic)

Status: APPROVED by Enrique 2026-09-24.

## Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Engine | Agent loop, but every rule check is a deterministic tool with a reason code | Auditable, testable, editable live in front of the panel |
| D2 | Surface | Inquiry inbox; click one and watch the agent work with streaming steps | Shows the whole rule suite fast |
| D3 | Output | Branded client-ready proposal + visible rule audit trail + EMAIL SEND | Tangible artifact; sales actually delivers it |
| D4 | Approvals | Full review queue, reason codes, override requires justification, audit log | Brief demands flagged-not-auto-approved |
| D5 | Phone intake | YES. One voice agent triages Guest/Staff concierge vs Group booking | Best continuity beat: call in, inquiry appears in the inbox |

## The data is a rule-coverage test suite

| Inquiry | What it tests |
|---|---|
| INQ-2001 | Clean auto-approve (18 rooms < 25, 10% < 12%) |
| INQ-2002 | Dual breach: 40 rooms > 35 AND 22% > 15% |
| INQ-2003 | SXSW hard blackout, no holds regardless of discount |
| INQ-2004 | Incomplete intake: no dates, no phone, fuzzy room count -> clarifying questions |
| INQ-2005 | Meeting capacity 300 > SOL-SAC max 140 -> alternate or off-site |
| INQ-2006 | Time-sensitive, easy, should move same day |
| INQ-2007 | PVD note routes >15 rooms to a Boston sister property THAT DOES NOT EXIST in the data |
| INQ-2008 | Youth group requires insurance certificate follow-up |
| INQ-2009 | Flag ONLY the 2-point discount overage, do not reject the whole inquiry |
| INQ-2010 | Seasonal cap (8%) buried in free-text notes overrides general ceiling (10%) |

## Two landmines we exploit on purpose

1. **SOL-PVD `base_rate_suite = -395`.** A negative rate. Validation layer quarantines the record,
   prices without suites, and raises a data-quality flag. Say this out loud in the demo: real
   integrations are full of `-395`, and an agent that prices off it pays the customer.
2. **Phantom sister property.** PVD's note routes overflow to a Boston-area property absent from
   the directory. Agent must surface the referral WITHOUT inventing inventory it cannot see.

## Rules engine

Thresholds live in `rules/` as data, never in the prompt:
- Per-property: `group_block_auto_approve_max_rooms`, `max_discount_auto_approve_pct`, blackouts,
  `max_meeting_capacity`
- Seasonal overrides parsed from free-text `notes` at BUILD time into structured rules:
  Denver ski weekends (Dec-Feb Thu-Sun, 8% ceiling), Sacramento legislature weeks
  (Jan-May weekdays, 8% ceiling), Chicago 2+ week lead time over 25 rooms,
  Columbus youth-group insurance certificate, Providence >15 room routing
- Every verdict: `{rule_id, status: pass|fail|flag, actual, threshold, human_reason}`

Panel-proof: "change Phoenix's ceiling to 12% and re-run" is a one-line edit plus a re-run, live.

## Agent tools (group domain)

1. `parse_inquiry(raw)` -> structured requirements, `missing_fields[]`
2. `validate_property_data(property_code)` -> quarantine verdicts (catches -395)
3. `check_availability(property, dates, rooms, room_type)` -> feasibility via availability_service
4. `evaluate_group_rules(inquiry)` -> verdict list, auto-approve vs flag vs hard-no
5. `price_block(inquiry)` -> rate table, nightly + total, discount applied, meeting space
6. `find_alternates(inquiry)` -> sister properties or alternate dates when blocked
7. `draft_clarifying_questions(inquiry)` -> for INQ-2004 style gaps
8. `generate_proposal(inquiry, pricing, verdicts)` -> branded HTML, printable to PDF
9. `submit_for_approval(proposal)` -> GM queue with reason codes
10. `send_proposal(proposal_id, recipient)` -> Resend email, gated on approval state

## Proposal delivery (new requirement)

- Branded HTML proposal, print-to-PDF via CSS, plus emailed to the client through Resend.
- **Gating:** flagged proposals CANNOT send until approved in the queue. Clean auto-approved
  inquiries can send on one click, or auto-send when `AUTO_SEND=true`.
- **Demo safety:** contact domains in the data are fictional and would bounce. `DEMO_MODE=true`
  routes all sends to an address Enrique controls while the UI displays the real contact.
  Every send is written to the audit log with actual recipient recorded.

## Phone intake and routing (new requirement)

ONE Telnyx assistant, one prompt with an explicit routing preamble, two tool families:
- Guest/staff concierge tools (Part 1)
- Group booking tools (above)

Flow: caller states a group request -> agent gathers requirements conversationally (same
`missing_fields` logic as INQ-2004) -> `create_inquiry` writes a structured INQ record to Blobs
-> it appears live in the sales inbox -> agent works it on screen.

Routing is a tool (`classify_intent`) returning a reason, not vibes in a prompt, so the panel can
see why a call went one way. Fallback: ambiguous intent asks one clarifying question.

## Demo beats (Part 2, ~4 minutes)

1. INQ-2001 -> clean auto-approve, proposal generated, emailed live.
2. INQ-2009 -> flags ONLY the 2-point overage, proposes 15% compliant alternative.
3. INQ-2007 -> catches the -395 validation failure AND the phantom sister property.
4. INQ-2003 -> hard blackout, offers alternate dates and properties instead of a dead end.
5. Phone call -> new group inquiry lands in the inbox live, then gets worked.

## Needs from Enrique

- Resend API key (or approval to use another provider) + the demo recipient address
