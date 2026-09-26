# implementer status

What I am doing right now, and what I did last. **Overwritten each iteration** — the reasoning lives
in `agents/completed.log.md`, not here.

> Rewritten at It69 when it had grown to 234 lines and opened on iteration 54's work. Trimmed again at
> It87: "Now" had quietly accumulated six iterations of CLAIMED entries, so the file said I was
> claiming six things at once. Same drift, slower. One iteration belongs here.

## Now

- **SHIPPED It95: no agent task was open, so I ran `SUBMISSION.md`'s pre-send gate — and it found a
  live defect on a demo screen.**
- **T32 needs no work.** PR #79 already added the *"Where that queue is today"* paragraph to
  `agent/sol.md`, wrapped in `voice:exclude` — exactly what T32 asks for. The plan never marked it.
  Flagged for the Planner rather than edited into their file.
- **The gate, item by item:** repo **PUBLIC** · failure injection **all three healthy**
  (`demo_flags` read directly) · production **serving the latest commit** (last ready deploy
  02:23:05Z, last commit 02:22:44Z) · `npx vitest run` **green** · site and `/api/chat` **200** ·
  Telnyx **$3.03**, which **fails** its own ">= $20" item and is already Enrique's · `demo:tidy`
  not run, correctly — it is the last step and the loop is still running.
- **The defect: the supervisor Archive was rendering "No ended sessions yet" with 23 ended
  conversations in the database.** `sessions` held **180** rows — 155 active, 23 ended, 2 taken
  over — and `useSessions` fetched the **100 newest** by `started_at`. Nothing closes a chat session
  on the web, so active rows pile up and the ended ones age out of the window: all 100 were active,
  so "Archived" read **0**. The runbook narrates that panel and says *"it will not be empty"*.
- **Fixed the window, not just the symptom.** `SESSION_FETCH_LIMIT = 500`, named and reasoned; the
  grid now says *"newest 500 only"* when it really is a window, and the empty state distinguishes
  *nothing has ended* from *nothing ended is in view*. `demo:tidy` is still the cure for a crowded
  live tile — the Archive just no longer depends on it. Red-checked by putting 100 back: the test
  fails with the screen that was live.

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

- `compile === live === export`, **29,411**, margin **589**. Re-checked whenever `agent/sol.md` moves.
- Guards I own, each red-checked by reintroducing the defect it catches: `admin-prose`,
  `voice-prompt-size`, `doc-citations` (counts, links), `list-counts`, `export-redaction`,
  `escalation-dedupe`, `walkthrough-quotes`, `data-seam`, `browser-env`, `doc-paths`,
  `diagram-guide`, `documented-commands`, `suite-integrity`, `transcript-titles`,
  `supervisor-archive`.
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
