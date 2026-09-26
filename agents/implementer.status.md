# implementer status

What I am doing right now, and what I did last. **Overwritten each iteration** — the reasoning lives
in `agents/completed.log.md`, not here.

> Rewritten at It69 when it had grown to 234 lines and opened on iteration 54's work. Trimmed again at
> It87: "Now" had quietly accumulated six iterations of CLAIMED entries, so the file said I was
> claiming six things at once. Same drift, slower. One iteration belongs here.

## Now

- **It132 SHIPPED: `docs/how-this-was-built.md`'s flagship anecdote did not add up.** This is the
  deliverable that argues the whole agentic approach, and its most persuasive sentence read *"would have
  converted **24** silent 401s into **11** working calls and **11** confusing ones"*, after calling them
  *"all **eleven** group tools"*. **11 + 11 ≠ 24.** The committed export a reviewer can open says **23
  webhook tools — 11 concierge/routing at `/api/tools/<name>`, 12 group at `/api/group/tool`** — plus a
  native `transfer` and `hangup` that carry no webhook and could not have 401'd at all. Two figures wrong,
  the third contradicting them, in the paragraph doing the most work in the package. Now **23 / 11 / 12**,
  with the split explained so a reviewer can count it themselves instead of trusting it.
- **It had been swept and cleared once**, at the T43 sweep: *"a historical account of a past debugging
  session, correctly past tense."* True, and beside the point — that sweep was hunting figures that **rot**,
  and this one was wrong on the day it was written. **A check scoped to one failure mode walked past
  another in the same sentence**, which is T51's shape again, so the new guard **derives** all three
  numbers from the export rather than restating them.
- Also fixed: the doc called itself *"this README"* while citing a guarantee it does not contain. It now
  names **G17** in `agent/sol.md`'s guardrail table, and the guard checks G17 still says it. And the
  day-two section, which listed four findings and stopped, now records the quieter later ones — five
  guards that passed while broken, a named deliverable with no test at all — and names the pattern:
  **a check written from an example inherits the example's blind spots.** That is the honest version of
  what this loop has actually been doing for the last twelve hours.
- `built-doc-counts.test.ts`, **10 cases**: the export must split into exactly the two dispatchers the doc
  describes (a third target fails), the stated total must equal the webhook count, and **the two halves
  must sum to it.** Red-checked three ways — the original 24/11/11 fails 1, the README slip fails 1,
  repointing one group webhook at a third dispatcher fails 2.

- **It131 SHIPPED: every count the README states about this repo is now a floor, a command, and a test.**
  The paragraph one below T51's had the same disease and worse numbers: *"about 35,100 lines of source"*,
  *"3,500 of deliverable documents"*, ***"13,800 of the agents' own coordination record"*** against a
  measured **38,850 / 4,682 / 26,706**. The third is **understated by 93%** — and it is the one the
  paragraph itself argues is *"arguably the more interesting"*, so the page was underselling its own best
  statistic. The sentence below claimed *"figures are given as floors or rounded, deliberately"*; two of the
  three were neither. **A document asserting it has solved rot is not evidence that it has.**
- Now: floors throughout (`over 250 files`, `more than 160` TS, `over 700 tests`, `over 38,000` source,
  `over 4,500` docs, `over 26,000` coordination, `over 80,000` total), **the six commands that produce
  them printed in the README**, and `repo-floors.test.ts` — **18 cases** that run those commands and fail
  if any floor has stopped being one, plus a case banning *"about N"* from that paragraph ever again.
- **One of the commands I was about to ship was wrong.** `git ls-files '*.md' | xargs wc -l` drops
  `data/SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md` — a filename with spaces, from the provided
  data — and silently undercounts by 48 lines. Now `-z` / `xargs -0`, with the reason in the README, because
  a reviewer who runs the documented command and sees an error reads it as the whole page being sloppy.
- **The It127 citation guard fired on me for the second iteration running, so I fixed the anchor, not the
  number.** `README.md:179` → `:185` → would now be `:202`, every move an edit higher up the file rather
  than any change to the claim. `plans/02-voice-realtime.md` now cites the README **by the sentence it
  quotes**, the guard looks for that sentence wherever it is, and a second assertion **bans a
  `README.md:<line>` citation from coming back**. Only my own correction block changed: the 2026-09-24 plan
  body below it is still byte-identical to its first commit.

- **It130 SHIPPED: T51 closed, both halves.** `README.md` no longer states elapsed time as a figure, and
  the guard that always claimed to ban that now actually does.
- **Re-derived every number from git rather than taking the plan's.** First commit **2026-09-24 12:35**;
  day one **12:35–16:21, 25 commits**; the gap to **09-25 09:24** is the night's sleep; the second window has
  run from there to now, **200 commits total**. Elapsed is **37.9h** now and **46.4h** at 11:00 against a
  README saying *"about 24"* — the plan's arithmetic was right, and now I know it rather than repeat it.
- **Two things the plan did not flag, both found by looking at the commit histogram.** The README called the
  second window *"a second session on day two"* — it is **17 hours spanning two calendar dates**, commits in
  every single hour. And ***"under 5 were active"* was undefined**: day one alone is 3h46m, so the figure is
  only true of Enrique's own hands. It now says **"hands-on"**, says whose hands, and says plainly that this
  is deliberately *not* the second window's wall clock — because most of that was the agent loop, and
  counting a loop's wall clock as human effort flatters the exact number the section exists to be honest
  about. Headline is now **"Two working sessions"**, which is true at any future reading.
- **Part B: the guard's header was right and its body was a transcript.** Both existing cases anchor on the
  word *"checkout"*, so neither could ever see this. Two new cases: `Elapsed: <figure>` banned outright, and
  a soft duration in the **same paragraph** as an absolute date — which is the sharper rule, because that
  pairing hands a reviewer both ends of the subtraction. Plus a case asserting the patterns still match the
  sentence they were written for and that the corpus still has dated paragraphs, so neither can pass by
  finding nothing. Red-checked by restoring the exact T51 sentence: **both fire.** `plans/` and `agents/`
  stay exempt, as the plan asked.
- **My own It127 guard caught my It130 edit**, which is the first time one of mine has fired on me: adding
  six lines to the README moved `README.md:179`, cited by `plans/02-voice-realtime.md`'s correction. It now
  reads `:185` in both the plan and the `CITED` table. That is the citation guard paying for itself three
  iterations after it was written.

- **It129 SHIPPED: the auto-triage gap is closed. `BACKLOG.md`'s caveat has moved to `:54` and says so.**
  The Planner called it *"the largest unverified surface in the package"* and **the one thing only a Tester
  can do** — blocked because *"the anon key returns zero rows … it needs the service-role key or a signed-in
  `group_sales` session, both of which belong to the agents holding the lock."* I hold both, so it was mine.
- **It had no test at all.** 52 test files, not one mention of `triageInbox` — the agentic group workflow is
  a named brief deliverable and its verification was one session's word. `triage.test.ts`, **15 cases**, runs
  the **real sweep twice against the real dataset** with no database (the suite strips credentials, so both
  stores fall back to memory — the hermetic setup turned out to be the whole reason this was testable):
  7 proposals + 1 follow-up on pass one, **every one `skipped_existing` on pass two**, and no reachable
  send path. Red-checked three ways; dropping the proposal half of the idempotency check fails 4.
- **The blackout refusal is real and it is deterministic.** INQ-2003 (Austin, Mar 10–19 2027) and INQ-2010
  (Sacramento, May 3–7 2027) are refused with the window named, **and refused identically on the second
  pass** — a refusal that softens on retry would put a quote on the board for dates the property will not
  take, and nobody would see it land.
- **I did not run it against production, and now that is a measured call rather than a cautious one.**
  Service-role read at 06:35Z: 13 inquiries live, and the only two a run would write to are **INQ-2012 and
  INQ-2013 — the two queued for deletion.** My own first estimate said four; the test corrected me. INQ-2003
  and INQ-2010 *look* bare and are not — they have no artifact **because the sweep correctly refuses them.**
- Also fixed: `BACKLOG.md`'s **"In progress" section, which had said *"the Implementer is on it"* for hours
  after the Implementer finished.** T29 closed 3 of 3; T4a shipped at PR #3; T4b/T4c deliberately never
  started, now recorded as a decision rather than a loose end. It is read at the top of every iteration.

- **It128 SHIPPED: `SUBMISSION.md`'s pre-send checklist, rehearsed end to end for the first time.**
  Nothing was open — T38–T50 closed, `BACKLOG.md`'s inbox empty, the Tester's iteration 61 fixed its own
  findings — so I ran the last gate in front of the package. **It passes**, on everything that is not
  Enrique's:

  | Item | Measured 2026-09-26 06:20Z |
  |---|---|
  | Deploy freshness script | **runs, prints `OK`, 3.7s.** Last commit `06:07:22Z`, last ready deploy `06:07:36Z` |
  | Failure-injection switches | **all three healthy**, `any_active: false` |
  | Live site + chat answers | **200 and answers.** Beat 2's *"What time is checkout?"* calls `get_policy` and the chip reads *"Policy 1, 2, 14"* — `demo-runbook.md:85`'s *"cites Policy 1"* is true **via the citation chip, not the prose**, which is worth knowing before saying it out loud |
  | `npx vitest run` | **710 / 53 files** green |
  | Repository visibility | **PUBLIC**, decided |
  | Telnyx balance above $20 | **$3.03 — the one item that fails.** Enrique's, already filed |
  | `npm run demo:tidy` | Enrique's last step; not run |

- **The hole it found: the sweep's precondition was never a step.** `demo:tidy` is only durable once the
  agent loop has stopped, and the checklist said so in a subordinate clause. Tidy first, stop the loop
  after, and you have tidied nothing. **Stopping the loop is now its own line, above the sweep**, guarded.
- **And the habit was mine.** "Verify your own deploy" had been a `POST /api/chat` every iteration — which
  opens a `sessions` row marked `active` that the sweep's 30-minute default leaves on screen, while beat 3
  opens on an *empty* supervisor dashboard. **257 active sessions right now; three of them I created while
  measuring.** `agents/README.md` now says verify with `GET /api/chat` → **405**, which reaches the same
  warm container and writes nothing (`chat.ts:227` runs before `:243` and `:579`). `docs/demo-runbook.md:60`
  had told Enrique exactly this for days. Nobody had told the agents.

- **It127 SHIPPED: the last four unread plans, audited and corrected.** A dated block prepended to each,
  nothing below it edited — 106 insertions, **0 deletions**, the shape used for `AGENTS.md` (It119) and the
  requirements audit (It125). Guarded by a new describe in `doc-paths.test.ts`, red-checked three ways.
- **The deadline in the plans is wrong, and I read the brief rather than repeat the Planner's fix.** The PDF
  says *"You'll have 5 business days from receipt to submit."* Received 09-24, so **~2026-10-01**, not the
  `~2026-09-27` that four files carry. Enrique submits **09-26 11:00 EST early, by choice.** Extracted with
  `pypdf`, after the repo's own extractor returned 74,698 characters of font data and no prose.
- **That wrong date was carrying an argument.** `03-messaging.md` priced SMS off *"Only ONE business day sits
  between them"*; there are **five**, and its own table clears 10DLC in four at the optimistic end. So
  *"SMS cannot clear before submission. That is settled"* did not follow from its numbers. It held anyway for
  an unrelated reason: no brand or campaign was ever registered (`HUMAN_INTERVENTION.md:122`), so the clock
  it prices never started.
- **`02-voice-realtime.md` states a capability a live call disproved.** Its Listen row promises *"Supervisor
  hears both sides"* — the supervisor hears the **guest only**; an assistant leg injects Sol's audio rather
  than streaming it (`README.md:179`). Its open "TEST FIRST" item 1 is answered **yes**: supervision does work
  against an `ai_assistant_start` leg. The conference fallback is now the fix for the audio gap instead.
- **`04-unlock-checklist.md` was the one I expected to be stale, and it is worse than stale.** Every box
  unticked while §2, §3 and §4 are all done — and §1 claims 10DLC *"Started 2026-09-24"*, false of the funded
  account. Nothing was ever queued, so nothing is coming.
- `01-build-plan.md`: D11 no longer needs Enrique's confirmation, all seven phData deliverables exist (the
  diagram as **SVG, not the PNG it names**), there are **six** sample transcripts not seven, and it still
  calls the net-new tool `availability_service` — a name `tool-naming.test.ts` bans.

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

- `compile === live === export`, **29,784**, margin **216**, and **platform-independent** — the
  old 29,411/589 was a CRLF artifact (It96). Re-checked whenever `agent/sol.md` moves.
- Guards I own, each red-checked by reintroducing the defect it catches: `admin-prose`,
  `voice-prompt-size`, `doc-citations` (counts, links), `list-counts`, `export-redaction`,
  `escalation-dedupe`, `walkthrough-quotes`, `data-seam`, `browser-env`, `doc-paths`,
  `diagram-guide`, `documented-commands`, `suite-integrity`, `transcript-titles`,
  `supervisor-archive`, `setup-env`.
- **Open for Enrique** (`HUMAN_INTERVENTION.md`): the `drop policy` SQL — the only item with a live
  security consequence, and disclosed in three places that must be deleted together if he applies it ·
  the Telnyx top-up, which unblocks beat 3 and G16 · `INQ-2012`/`INQ-2013` · rotating the SIP
  credential. **The bare-pet-question item is RESOLVED (It105) and needs no decision.**

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
