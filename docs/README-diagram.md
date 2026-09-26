# Architecture diagram

Two files, one model:

- **`architecture.drawio`**: three pages, opens in [diagrams.net](https://app.diagrams.net) (File -> Open From -> Device). Editable; every node is a real cell, not an image.
- **`architecture.svg`**: a hand-authored render of the *Future state* page, sized for a projector. Nothing under 12px, black-on-white contrast, and no meaning carried by colour alone. There is no drawio CLI in this environment, so the SVG is authored directly rather than exported.

  Those three are measured rather than asserted, by `src/lib/rules/__tests__/diagram-guide.test.ts`: the `viewBox` is 1:1 with the declared width so the sizes are real pixels and the smallest is **12**; every text colour clears **4.5:1** against white, the lowest at **5.05:1**; and the TODAY/FUTURE distinction is carried by the border, **31 dashed nodes against 31 FUTURE tags**, so it survives without colour. The size promise was the one that needed fixing — the 52 tags were at 11px until iteration 136, which made the smallest text on the page the text doing the accessibility work.

Both are built from the same component model as the in-app Backend page
(`src/components/admin/backendMapModel.ts`): the same components, the same real provider names, and
the same "why this over the alternative" reasons. The app map is the live, narratable version; these
two files are the submittable one. **They are also held to the same status**, by
`src/lib/rules/__tests__/backend-map-status.test.ts`: neither surface may mark anything as waiting on
an account, and both are blocked only on 10DLC. That check exists because the two drifted — both were
understating the build for most of a day, and each was findable from the other.

## The pages

| Page | What it shows |
|---|---|
| **Future state (production)** | The production-hardened system: guest channels, edge and identity, telephony and voice, agent runtime, async work, data platform, upstream systems of record, delivery, staff surfaces, and security and tenancy. Plus a cross-cutting observability band along the bottom and a failure panel down the right. |
| **Today (MVP)** | What actually runs at the demo: one Netlify deploy, one Supabase project, Telnyx, Anthropic. Status is marked honestly as LIVE, PENDING or BLOCKED. |
| **Degradation and failover** | Six rows: the upstream failure, the mechanism that absorbs it, and what the guest and the staff actually see. |

## TODAY versus FUTURE

Every node on the future-state page carries a tag, and the tag is backed by a shape, not a colour:

- **TODAY** (solid border). It runs in the build being demoed. If its detail line starts with `Future:`, the component keeps its job and gets hardened (for example PII masking exists today; the retention sweep does not).
- **FUTURE** (dashed border). Designed, argued for, not built. Where it replaces something that exists, the detail line says what that is (`Today: Supabase Storage`).

On the *Today* page the same convention distinguishes LIVE (solid), PENDING (dashed, waiting on an
account) and BLOCKED (dotted, blocked by something outside the code).

**At submission the page carries 24 LIVE nodes, 0 PENDING, and 1 BLOCKED — SMS.** That is
worth stating because it was not true when the page was drawn and the page was not redrawn. Through
most of the build the Anthropic key, the phone number, the voice assistant, the transcript webhook
and email were all marked PENDING or BLOCKED, and each of them came up in turn while the diagram
kept saying otherwise — a page whose whole job is honest status, quietly understating the build it
describes. Corrected at iteration 133 against the live systems rather than against the notes: the
Anthropic API answers on `claude-sonnet-5`, `+1 (305) 786-6217` is active on the account, the
assistant carries 29,784 instruction characters and 25 tools, **every voice session in Postgres has a
transcript** — nine of nine as of 2026-09-26 — the sending domain is verified and proposals have been
delivered.

That clause said *"six phone calls"* until iteration 140, and the six was the `limit=6` on the query
that measured it: the number reported was the one typed into the request. It is stated as an invariant
now for the reason every count in `README.md` is a floor — this one moves every time anyone dials the
number, where **25 tools** moves only on a re-provision and has a test holding it still.

SMS is the honest exception, and its reason has been corrected too. It is not that carrier
registration *could not clear in time* — the brief allows five business days, so the timing was
never the binding fact. It is that **no brand or campaign was ever registered**, so the clock never
started. The email path carries the demo, and `docs/architecture.drawio`'s delivery adapter is the
component that makes swapping them a configuration change.

## The four answers the brief asks for

**Where guest and reservation data comes from.** Today: four provided CSV exports plus the
front-desk policy reference, parsed by a seeder into Supabase reference tables, with the rules
buried in free-text `notes` extracted at build time and `SOL-PVD.base_rate_suite = -395`
quarantined. In production the source of record is Solstice's existing estate, on the right of the
diagram: the PMS (Oracle OPERA Cloud through the Hospitality Integration Platform; Mews, Cloudbeds
or Agilysys at smaller properties), the central reservation system (SynXis, Amadeus or a
brand-built CRS), loyalty and CRM (Revinate, Cendyn or Salesforce Marketing Cloud) and sales and
catering (Amadeus Delphi). Everything reaches the agent through one anti-corruption layer, which is
the only component that knows a vendor's field names. Reads first, on read-only credentials; writes
go through the queue behind an approval gate. The tools call `getReservation`, never a vendor API,
so a property migrating PMS is a change in one directory.

**Where the agent runs.** Two runtimes, one definition, one tool layer. `agent/sol.md` compiles to
the Telnyx assistant config for voice and the Claude system prompt for chat, and both call the same
tool service, so voice and chat cannot disagree about policy. Voice turn-taking, barge-in and the
audio path stay inside the Telnyx AI Assistant, because rebuilding interruption handling for
telephony is the classic trap. Chat runs in our own process: today a Netlify Function at
`/api/chat`, in production the same code as a stateless container on Amazon ECS Fargate in private
subnets, behind an API gateway, reaching the model through a gateway that owns timeouts, retries,
the circuit breaker and the per-tenant token budget. Business rules never live in the runtime; they
live in `src/lib/rules` as data, which is why a threshold can be changed live during the panel.

**How it is monitored.** The bottom band. Structured JSON logs correlated by `session_id`,
OpenTelemetry traces and metrics (one trace per turn: model, tools, PMS, delivery), LLM-level
observability in Langfuse for prompt version, tokens, cost, tool path and groundedness rate per
release, dashboards and SLOs for p95 per tool and per channel plus containment, escalation and
delivery success, and PagerDuty alerting on SLO burn, an open circuit, a `grounded:false` spike,
queue depth or a delivery failure. The release gate is part of this: typecheck, rules unit tests
and a golden-transcript run before any prompt or threshold ships. One piece of it exists today and
is the piece a non-engineer can read: `tool_invocations`, `audit_log` and the supervisor console
already show every tool call, its masked arguments, whether the answer was grounded and how long it
took. The numeric targets, how they were measured and where the first target was wrong are in `docs/latency-target.md`.

**How it degrades when something upstream fails.** Six named paths, on the right of the future-state
page and expanded on the *Degradation and failover* page.

1. **PMS or CRS unreachable.** The circuit opens, reads fall to the Redis cache stamped
   `stale_as_of`. With no cache the tool returns `grounded:false`, Sol says it cannot confirm that
   and books a callback. Writes queue. Nothing is guessed.
2. **Model provider down or throttled.** Retry, then fail over from the Anthropic API to Amazon
   Bedrock. If both are down, chat answers only what the rules engine can prove and offers a human;
   voice plays a held message and transfers.
3. **Telephony degraded.** A standby DID on a second carrier takes the traffic, and the number on
   the site is runtime config. If the assistant is unhealthy, calls forward to central reservations
   and a session row is still opened.
4. **Email or SMS provider fails.** Same adapter, different sender. If every sender fails the
   proposal stays on the queue and the console reads *not sent*. A proposal is never marked sent on
   a failed send.
5. **Database write outage.** Multi-AZ failover; the app is read-only while it happens, chat
   continues from cache, new turns buffer in SQS and replay in order.
6. **Realtime stream drops.** The supervisor console falls back to five-second polling behind a
   *live updates degraded* banner, rebuilding the transcript from the same rows the archive reads.

The rule underneath all six is the one guardrail the whole build rests on: `grounded:false` is a
machine-checkable order to escalate, so the system degrades to a smaller, honest answer plus a
human, never to a confident guess.
