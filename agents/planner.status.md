# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 89 — 2026-09-25 ~19:20 EST

### Inbox empty. Lock held since 19:16. T34's redaction CLOSED at HEAD (PR #81).

### My iteration-88 sweep had the exact flaw #81 names

PR #81 says of its own earlier scan: *"The scan looked for a list of things I predicted, and a SIP
URI is none of them."*

**That is what I did one iteration ago, and I presented the result as a bound.** I compared tracked
files against **five `.env` variables I chose by hand**, then wrote into T34 that this was *"the
only credential ever committed — decide on one item, not on an unknown number."*

**`TELNYX_SIP_USERNAME` was not among my five.** My sweep could not have seen the class of value it
was claiming to bound. The conclusion was right only because #81 had already found the thing I was
implicitly ruling out.

### Redone properly: every variable, not a chosen list

Parsed `.env` programmatically — **23 variables with values of 12+ characters** — and checked each
against `git grep HEAD`.

**Every actual secret is absent from HEAD:** `TELNYX_SIP_PASSWORD`, `TOOL_WEBHOOK_SECRET`,
`PROPOSAL_LINK_SECRET`, `DEMO_PASSWORD`, `TELNYX_PUBLIC_KEY`, `TELNYX_SIP_USERNAME`,
`TELNYX_SIP_URI`, `TELNYX_TELEPHONY_CREDENTIAL_ID`, and the four API keys.

**Seven do appear, all identifiers or deliberately public:** phone number (published on purpose),
base URL, model name, voice name, and three resource ids (`TELNYX_ASSISTANT_ID`,
`TELNYX_CALL_CONTROL_APP_ID`, `TELNYX_SIP_CONNECTION_ID`).

**T34's bound stands, and now rests on a method that could have falsified it.** The answer did not
change; the reason it can be trusted did. Re-sourced in the task text.

### One note for whoever finishes `no-committed-credentials.test.ts`

It is untracked in the working tree. Two **resource identifiers** are tracked and I am not
proposing they be removed — but the guard's authors should **decide explicitly whether identifiers
are in scope and write the answer down**, because the next person to add one will read the test,
not the plan.

### PR #81 is the right shape

The fix is a rule in the export script, not a value in the artefact: every
`sip:<user>@sip.telnyx.com` loses its local part and the script **refuses to write a file where one
survives**. Red-checked twice, including against *a different credential under a brand-new key* — a
test that only knew the one string would have been theatre.

### Still open

`SUBMISSION.md:45` reads *"Two things they did not ask for"* above **three** bullets.

### The plan is accurate and correctly ordered

**Enrique:** the SQL paste · T34 rotation decision · Telnyx top-up · T21.
**Agents:** the one-word `SUBMISSION.md` fix · finish `no-committed-credentials.test.ts`.

### The single most important remaining item

**The `drop policy` paste** — still the only open item with a live security consequence in the
running system.
