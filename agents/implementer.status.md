# implementer status

What I am doing right now, and what I did last. **Overwritten each iteration** — the reasoning lives
in `agents/completed.log.md`, not here.

> Rewritten at It69 when it had grown to 234 lines and opened on iteration 54's work. Trimmed again at
> It87: "Now" had quietly accumulated six iterations of CLAIMED entries, so the file said I was
> claiming six things at once. Same drift, slower. One iteration belongs here.

## Now

- **SHIPPED It104: audited every policy claim in the prompt. Two passes clean, and the third found a
  real answer Sol was refusing to give.**
- **Pass (a) — inverted It93's sweep.** Ten quoted spans in `agent/sol.md` read like policy language;
  **two are the real quotes** I installed last iteration and the other eight are guest utterances, tool
  strings or Policy 15's own escalation trigger. **The fabrication was the only one.**
- **Pass (b) — every `Policy N` reference.** All twelve cited numbers exist and match their titles.
  Three policies are never named in the prompt: **10 smoking, 11 lost and found, 14 incidental hold** —
  all fifteen are in `policies.json`, so `get_policy` can still serve them.
- **So I asked all three as a guest would.** 10 and 14 answered correctly with a tool call. **11 did
  not.** *"I left my laptop charger in the room"* reached `get_policy` **0 of 4 times**; Sol said *"I
  don't have visibility into lost and found from here"* and pointed at the property, never stating the
  policy that exists — 90 days then donated, guest pays shipping, **no reimbursement and no exception
  process**. Asking *"what is your lost and found policy?"* worked fine. The guest's own phrasing was
  the failing case.
- **The prompt already says never answer a policy question from memory; it was not recognising this as
  one.** So the clause names the confusion rather than repeating the rule, and keeps the honest half —
  it still says it cannot check whether an item was found.
- **Measured on a draft deploy before touching production: 6 of 6 reach `get_policy`**, with both
  controls (checkout time, the ADA question) unchanged. The ring case now gives Policy 11's firm answer
  instead of deflecting, which is the candour the package claims.
- Re-provisioned after diffing: the change is those three lines and nothing else.
  `compile === export === live` at **29,438**, margin **562**.

## Demo rehearsal coverage — what is actually verified

| Beat | State |
|---|---|
| 1. The problem, no screen | nothing to verify |
| 2. Guest chat | **rehearsed.** Checkout cites Policy 1; parking refuses a number. The ADA question was **fixed** — see below |
| 3. The phone | **BLOCKED on the Telnyx balance.** The only untested beat, and it also gates G16's voice half |
| Guardrails | **14 of 19 re-verified against the current build** after five prompt changes, using §5's own test cases. G16 needs a call, G8 needs an env flag on production, G17/G19 are the Tester's harnesses, G3/G4 are code-backed and theirs |
| 4. Group booking | **rehearsed.** INQ-2009 is Phoenix, flags the ceiling at 17% vs 15%, `$7,994.25` is test-pinned, the yoga value-add is really in the payload, and "assumption 3" is really assumption 3 |
| 5. Failure injection | **healthy half rehearsed** — R55004 returns the guaranteed 2pm. The injected half needs the switch, which I will not flip on a shared system |
| 6. Cost | **rehearsed, and corrected** — see below |
| 7. Architecture | **rehearsed.** Exactly seven tabs, as the beat says |
| Entry points | landing page, `/admin` and `/login` all 200; the bundle and widget mount are served |
| Pre-flight commands | all seven documented `npm run` scripts exist; `typecheck` and `data:check` pass; `demo:preview` added because the checklist named a command that did not exist |

**Two defects the rehearsal found, both on the demo path, both fixed:**

1. **Beat 2's ADA question landed once in four** (PR #117). A bare *"Can I bring my dog?"* usually
   asked "which hotel?" first, and once claimed *"pet policy can vary by property"* — false, and an
   invented fact produced without a tool call. Reworded to the phrasing that reaches `get_policy`
   3 of 3, matching the transcript.
2. **Beat 6 told the presenter to say the opposite of the screen** (PR #118). *"Telephony is the
   majority of the bill"* — measured, it is 49.1%, because our traffic is 148 chats to 9 calls. Moved
   to the projection, where it is true by construction, with a warning not to claim it about the
   measured row.

## Standing state

- `compile === live === export`, **29,438**, margin **562**, and **platform-independent** — the
  old 29,411/589 was a CRLF artifact (It96). Re-checked whenever `agent/sol.md` moves.
- Guards I own, each red-checked by reintroducing the defect it catches: `admin-prose`,
  `voice-prompt-size`, `doc-citations` (counts, links), `list-counts`, `export-redaction`,
  `escalation-dedupe`, `walkthrough-quotes`, `data-seam`, `browser-env`, `doc-paths`,
  `diagram-guide`, `documented-commands`, `suite-integrity`, `transcript-titles`,
  `supervisor-archive`, `setup-env`.
- **Open for Enrique** (`HUMAN_INTERVENTION.md`): the `drop policy` SQL — the only item with a live
  security consequence, and disclosed in three places that must be deleted together if he applies it ·
  the Telnyx top-up, which unblocks beat 3 and G16 · `INQ-2012`/`INQ-2013` · rotating the SIP
  credential.

## What I shipped, one line each

- **It92: the three demo-path sentences** (PR #124). **It91: G8 verified without production env**
  (PR #123). **It90: the rest of the guardrail re-check** (PR #122). **It89: guardrail regression**
  (PR #121). **It88: the email's pet question** (PR #120). **It87: demo rehearsed end to end** (PR #119).
- **It53: 0 missing → ready to price** (PR #51). **It52: dashboards in plain words** (PR #50).
  **It50: vision doc** (PR #48). **It49: runbook vs screens** (PR #47). **It48: board
  verification** (PR #46). **It47: honest intent badge** (PR #45). **It46: telephony intent write**
  (PRs #43, #44). **It42: guardrail check** (PR #40). **It41: protocol step** (PR #39).
  **It40: commit the record** (PR #38). **It39: triage** (PR #37). **It36: pre-send pass**
  (PR #35). **It35: T17** (PR #34). **It32: T18** (PR #32). **It31: integration doc** (PR #31).
  **It30: latency** (PR #30). **It29: deploy check** (PR #29). **It28: T16** (PR #27).
  **It26: T15a** (PR #25). **It24: T14** (PR #23). **It21: T13** (PR #21). **It20: T12** (PR #20).
  **It19: cheat-sheet** (PR #19). **It18: pre-send + drift guard** (PR #18). **It17: T11**
  (PR #17). **It16: T10** (PR #16). **It15: T5** (PR #15). **It14: T9 docs** (PR #13).
  **It13: acceptance test** (PR #12). **It12: rehydrate inquiries** (PR #11). **It11: pre-send**
  (PR #10). **It10: T8** (PR #9). **It9: T7** (PR #8). **It6: T6** (PR #6). **It5: T1c** (PR #5).
  **It4: T1b** (PR #4). **It3: T4a** (PR #3). **It2: T3** (PR #2). **It1: T1** the mic (PR #1).
