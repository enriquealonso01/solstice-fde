# Part 1 Plan: Guest and Staff Concierge Agent (conversational)

Status: APPROVED by Enrique 2026-09-24. Decisions locked below.
Deadline context: challenge received 2026-09-24, ~72h turnaround, submit to the address in the brief.

## Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Voice brain | Telnyx-native LLM + our typed webhook tools | Latency, and business logic stays deterministic and live-editable |
| D2 | Channels | ONE assistant across phone, web voice, web text | No second brain, no drift. Panel-proof answer |
| D3 | Escalation | Live warm transfer to Enrique's phone + context packet | The memorable demo beat |
| D4 | Staff console | In scope | Brief says Guest AND Staff |
| D5 | Retrieval | No vector DB. Structured tools + section-level policy citation | 20KB corpus. RAG here would be theater |
| D6 | Demo state store | Netlify Blobs | Zero setup, native to host |
| D7 | Latency target | p50 <= 800ms, p95 <= 1.5s to first audio | Human turn-taking; >1.2s makes callers repeat themselves |

## Architecture

```
PSTN phone ──┐
             ├─> Telnyx AI Assistant (ASR + LLM + TTS + barge-in)
Browser mic ─┘        │  (@telnyx/webrtc anonymous login, target_type=ai_assistant)
                      │
Browser text ─> Telnyx assistant chat API
                      │
                      v  webhook tools (HTTPS, secrets in headers)
              Netlify Functions  ──> data layer (bundled JSON, built from CSVs)
                      │            └─> Netlify Blobs (escalations, bookings, transcripts)
                      v
              Live trace panel + staff console (poll Blobs @1s)
```

Portability proof: ship an unused OpenAI-compatible `/v1/chat/completions` adapter backed by Claude.
Answers "could this run on Bedrock or Cortex?" with code, not a shrug.

## Tool catalog (the contract; business logic lives HERE, not in the prompt)

All tools return `{ok, data, grounded, citations[], masked_fields[]}`. `grounded:false` forces
the agent to say it cannot confirm and to escalate.

1. `identify_guest(phone? | confirmation_number + last_name)` -> masked guest profile
2. `get_reservation(reservation_id | guest_id)` -> stay details, rate plan, status
3. `get_policy(query)` -> policy sections + citation ids (rendered in UI)
4. `check_late_checkout(reservation_id, requested_time)` -> tier rule + availability
5. `check_upgrade_eligibility(reservation_id)` -> tier rule + same-day inventory
6. `book_amenity(reservation_id, amenity, time)` -> confirmation, writes to Blobs
7. `check_service_recovery_eligibility(reservation_id, issue_reported_at)` -> 72h window math,
   including the in-stay-complaint wrinkle in Policy 5
8. `check_comp_authority(amount, stay_charges[])` -> within $50 vs needs AGM, with the
   multi-issue aggregation rule from Policy 7
9. `create_escalation(...)` -> ticket id, appears live in staff console
10. `transfer_to_human(reason, escalation_id)` -> Telnyx transfer with context read-back
11. `get_property_info(property_code)` -> deliberately returns NO chain-wide parking rate (Policy 12)

### Net-new tool (brief requires >= 1)
`availability_service`: synthetic same-day inventory by property, date, and room class.
Justification to state out loud: Policies 1 and 6 depend on "same-day availability" but no
inventory-by-date exists in the provided exports. Without it the agent would have to invent
availability, which the brief forbids. Stated assumption + synthetic service + a clean seam
where a real PMS (Opera/Cloudbeds) plugs in.

Second net-new candidate already folded in: `check_comp_authority` encodes dollar-threshold
policy math the data never contains.

## Guardrails

- Never invent policy, rate, or availability. No grounding -> say so or escalate.
- Refund or comp above $50, or outside the service-recovery window: never promised, always escalated.
- Advance Purchase is non-refundable. Agent says it honestly, offers travel-insurance recourse.
- Medical, legal, disputes: escalate. Safety or law enforcement: straight to GM path (Policy 15).
- PII: card last4 never spoken aloud, masked in traces and logs. Email and phone masked in the
  trace panel. Masking is enforced in the tool layer, not the prompt.
- Pets vs service animals: ADA rule encoded (may ask task, may not ask documentation or fee).

## UI surfaces (single deployed app)

1. **Guest page**: push-to-talk mic (Telnyx WebRTC) + text chat, same agent either way.
2. **Live trace panel**: every turn shows tool calls, arguments, policy citations, per-turn
   latency, masked fields. This is the technical-persona wow and it proves the guardrails.
3. **Staff console**: front-desk policy Q&A + live escalation queue with full context packets.

## Escalation packet schema

```json
{"escalation_id","created_at","channel","guest":{"id","name","tier","masked_contact"},
 "reservation":{"id","property","dates","rate_plan","status"},
 "category","severity","summary","policy_citations":[],"attempted_resolutions":[],
 "transcript_excerpt","recommended_action","authority_required"}
```
Handoff carries this packet. No restart, which is the brief's explicit ask.

## Demo script (5 beats, ~4 minutes)

1. Web mic, Michael Chen (Platinum): late checkout -> guaranteed 2PM, cites Policy 6, availability checked.
2. Pets question -> ADA nuance, correct and specific.
3. Parking rate -> agent refuses to quote a number, points to property. Proves "never invent".
4. Live phone call: Denise Franklin refund dispute -> outside 72h, honest explanation, points offered,
   escalation created, staff console updates on screen.
5. Warm transfer -> Enrique's phone rings with spoken context read-back.

## Telnyx provisioning (all via API, no portal clicking)

1. Buy number, 2. create assistant with prompt from repo, 3. register webhook tools,
4. attach number to assistant, 5. set post-call insights webhook, 6. mint WebRTC anonymous
login for the browser, 7. set transfer target.
Assistant config is generated FROM the repo (`agent/concierge.md`) and pushed, so the .md
deliverable is the source of truth, not documentation written after the fact.

## Deliverables mapping (brief)

- Source code + agent config .md: repo, `agent/concierge.md`
- Sample transcripts: captured via insights webhook, exported to `transcripts/*.md`
- Architecture diagram: Part 3
- Native export: Telnyx assistant JSON committed to repo

## Assumptions to state on the call

1. No inventory-by-date in exports -> synthetic availability service, real PMS seam documented.
2. Guest identity by caller ID; unknown callers verified by confirmation number + last name.
3. Payment data is last4 only in the provided export; assume tokenized PAN in the real PMS.
4. Property parking rates intentionally absent, matching Policy 12.

## Risks and fallbacks

| Risk | Mitigation |
|---|---|
| Live phone demo fails on stage | Web mic path is the backup; one recorded run on hand |
| Telnyx or model outage | Tools still answer deterministically; agent degrades to "let me get a human" |
| Function cold start blows latency | Tools tiny, data bundled in-process, no cold DB |
| Panel asks for a live change | Logic is in typed tools with tests, not buried in a prompt |

## Needs from Enrique (unlock step)

- Telnyx API key (confirmed ready) + the phone number to use as transfer target
- Anthropic API key (for the portability adapter and the text path if we swap)
- GitHub auth for repo creation
- Netlify auth for deploy
