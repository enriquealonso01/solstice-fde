# tester status

Read this cold and you should know what to do next. The permanent record is `agents/tested.log.md`
(~3400 lines); this file is only the working state. Per-iteration narrative is trimmed out of here on
purpose — it is all in the log.

> Use Write, not `printf >`, on this file. Iteration 17 truncated it that way.

---

## Iteration 41 IN PROGRESS: /api/group/triage - a plan claim never tested. It says it sweeps every
## inquiry, drafts only, SENDS NOTHING, is idempotent and audited. Checking for a dry-run before
## mutating 13 inquiries' worth of demo state hours before submission.

## Iteration 40: PR #51 VERIFIED against a prediction. Deployed 20:58:39Z, after its 20:58:30Z commit.

I derived from the data BEFORE opening the screen that exactly two rows should read "ready to price" -
INQ-2003 and INQ-2010, the only complete inquiries without a proposal - and the live table shows
exactly those two. "0 missing" appears nowhere; the three incomplete rows keep their counts
(INQ-2004=4, INQ-2012=1, INQ-2013=1). Their "ten of thirteen" claim was accurate to the row.

**Sharpened for Enrique: my junk rows are rows ONE and TWO of the inbox**, not merely "visible" -
the table sorts newest first, so beat 4 opens on "Vantage Labs DELETE-ME" with INQ-2009 nine rows down.

## Iteration 39: PR #50 VERIFIED. All five admin routes render, new copy live, 0 defects in the sweep.
`tool_invocations` survives only on /admin/backend, which is the engineer-facing screen by design.
"Sample data" is absent because the site is live and correctly shows "Connected" - checked, not assumed.

**Two harness false results before a true one, both now fixed in `scratchpad/uicopy.js`:**
- Five routes all returned exactly 9188 chars. Identical byte counts across different pages means the
  navigation never happened. **Assert the route you landed on, not the one you asked for.**
- Then four of five "failed" to navigate - but the reused Chrome profile still held a SUPERVISOR
  session from iteration 29, the harness printed "already signed in" and skipped the login, and
  supervisor is CORRECTLY redirected off the group/cost/backend routes. **Never trust an existing
  session**: clear cookies over CDP before every sign-in and fail loudly if the login form is absent.
  Incidental bonus: this re-verified role scoping at the UI level, which had only been proven at the
  API and RLS layers.

## Iteration 38: the demo's data re-checked, all clean. NO DEFECT FOUND - that is the result.

inbox 13 rows / 13 distinct / 0 duplicates (PR #22's dedupe still holds, including for the two
runtime-created rows that were the only ones able to trigger it). All four flagged proposals still
`awaiting_approval` with `sent_at` and `sent_to` null, PRP-2007 included after I regenerated it in
iteration 27. Sweeps: 214 verdict fields 0 issues, 10 of 10 PDFs 0 issues.

## State after iteration 37: nothing of mine is FIXED-PENDING. No lock held. Nothing in flight.

Everything I have shipped has been re-tested by a later iteration and marked VERIFIED.
`origin/main` is `fe08a69`, deployed and published at 20:50:14Z (after its 20:49:39Z commit).

---

## Do next, in order

1. **Re-run the two sweeps and the group-data check** after any further content or data change. Both
   are scripted and cheap: `scratchpad/sweep.py`, `scratchpad/pdfsweep.py`, plus
   `GET /api/group/inquiries` (expect 13 distinct) and the four flagged proposals still unsent. Done at
   iteration 38, all clean.
2. **Whatever another agent ships next** — re-test it rather than starting something new. At this point
   in the timeline a fresh area is worth less than confirming the last change did what it claimed.
3. **The three-run repeat on any prompt-level behaviour.** Single runs are not evidence: PR #26 passed
   run 1 and leaked run 2.

---

## Blocked, needs Enrique — all in `HUMAN_INTERVENTION.md`

- **Beat 5 / T5 failure injection.** This session refuses `/api/flags` **reads and writes**
  (auto-mode classifier, `[Feature Flag Writes]`). The runbook calls it "the moment they will
  remember" and I cannot walk it at all. Allow that endpoint, or flip `pms_offline` yourself for two
  minutes and I will observe. **Use R55022** (Zhang, check-in 2027-03-12) as the fixture, not R55012 —
  R55012 is checked out, so the refusal lands on the dates before the PMS is ever consulted.
- **Beat 3 cannot run.** The runbook's own pre-flight demands Telnyx > $20; balance is **$3.09**. That
  is 4 of ~18 minutes and the split-screen moment. Top up, or present it from the real call in
  `transcripts/voice-call.md`.
- **Delete `INQ-2012` and `INQ-2013`.** Mine, from testing. Beat 4 says "click it from the inbox list"
  and that list shows 13 rows including **"Vantage Labs DELETE-ME"**. I have no DB write access.
- **`demo:tidy` before they join** — 90+ sessions read `active` because chat has no hangup event, and
  most of that growth is my own testing. Dry run: deletes nothing, closes 85. **It will not fix the
  "classifying…" badge** — that is a separate thing, now fixed forward-only, so 116 historical rows
  keep the old badge. A backfill from each session's own `classify_intent` trace row would be cheap;
  not needed for any beat.
- **G16's voice half has never executed.** Its test case is *unset `TELNYX_TRANSFER_TARGET` and ask for
  a manager on a call*. Configured path verified live; unconfigured branch correct in source
  (`escalation.ts:165-168`). Unset it for two minutes and I can drive the webhook — no call, no spend.
  It is the only one of the 19 guardrails without an execution record.
- **Chat cannot open a group inquiry.** `create_inquiry` is absent from the chat registry while
  `solPrompt.ts:69` instructs it; the Telnyx assistant's live tool list confirms voice has it. Sales
  inbox delta is 0, the escalation is miscategorised `other`/agm, and a prompt-level workaround took
  two attempts to stop leaking. `registry.ts:184` exists for exactly this. Your call; I have not made it.
- **Warm the site before the panel arrives.** Tool webhooks are p50 196ms / p95 304ms, but the first
  call after idle was **1310ms**. One request a minute beforehand. No code change.

---

## Shipped by me, each re-verified by a later iteration

| PR | What was wrong |
|---|---|
| #7 | Chat told guests "a colleague is joining this chat now" when nothing was |
| #14 | A failed chat turn showed the guest **nothing** — `done` overwrote the failure |
| #22 | A phoned-in inquiry listed **twice** in the sales inbox |
| #24 | "Will I be charged if I cancel?" answered wrongly **twice out of two**, on money |
| #28 | Chat told guests "I don't have a create_inquiry tool available" (3/3 → 1/3 → 0/4) |
| #33 | "passing this to **the the** Boston-area sister property" in the verdict beat 4b shows |
| #36 | Proposal PDF read "Alumni Assoc**..** Reference", plus 4 latent sites |
| #41 | `sessions.intent` never written, so every row read "classifying…" (superseded by #43, which added the telephony leg I had missed) |
| #49 | The handoff transcript quoted one row's summary beside another row's action |

Also repaired, not code: regenerated PRP-2007's persisted PDF after proving from source that the
regeneration was state-preserving, then confirming row id / status / revision / all pricing unchanged.

---

## Verified without needing a fix

**Guardrails 18 of 19** with evidence: G1 G2 G3 G4 G5 G6 G7 G8 G9 G10 G11 G12 G13 G14 G15 G17 G18 G19.
G16: chat half proven (PR #7, #28), voice half blocked above.

Group approval gate on all four send paths including the agent's own tool with a valid secret (twice,
40 PRs apart); RLS per JWT below the app including **writes** (cross-boundary UPDATE and DELETE affect
zero rows, confirmed by re-counting not by status code); G17 masking across all 500 trace rows with the
sweep proven complete rather than capped; the PDF access matrix and every figure against Postgres; the
follow-up gate including approve-then-swap-the-words; T2 the whole app as a stranger; the chat widget
in a real browser; `docs/latency-target.md` re-measured independently; `exports/telnyx-assistant.json`
byte-identical to the live assistant with the secret genuinely redacted; every policy number and all
five guest rows in the cheat sheet; beat 4a to the cent ($7,994.25) and beat 4b; `transcripts/` free of
superseded wording; other agents' PR #11, #20, #25, #43.

---

## Method rules, each learned by getting it wrong

1. **"Exit 0 and no output" is not success.** A canceled deploy reported 0 because the pipeline ended
   in `head`. Run `netlify deploy` bare, read its own exit code, confirm with `listSiteDeploys`.
2. **Verify at the surface a human touches, not the layer you changed.** Twice the code was fixed,
   deployed and green while the artifact a person opens was still wrong.
3. **Is it even deployed?** Four iterations turned on this. `commit_ref` is null on this site, so
   compare the commit's own timestamp with the published deploy's `created_at`. A build created before
   a commit existed cannot contain it.
4. **A test or control that silently does nothing looks exactly like a pass.** Four instances: a
   handler test that returned early on a 503, a revert that never applied, a PDF sweep that declared
   clean having read zero files, a capped 500-row query. Make instruments count what they examined.
5. **Get the artefact to disk with no interpreter in the path, then inspect.** `curl -o file`, never
   `curl | python`. Seven encoding false positives; the worst nearly had me re-provision the live voice
   agent to fix nothing — and my *first* byte-level check confirmed the wrong answer because the
   intermediate file was already corrupted.
6. **Read the sentence, do not grep it.** A phrase list cannot tell a promise from a refusal to make
   one, nor transcript history from a live banner.
7. **Read the tool's argument contract before believing its answer.** The tools ignore unknown keys
   rather than erroring, so a typo is indistinguishable from a bug. Cost two false starts.
8. **Model output needs three or four runs.** PR #26 passed run 1 and leaked run 2.
9. **Read the artefact, not the diff.** A pre-merge draft line nearly became a false report.
10. **Release the lock in the same iteration you take it**, and do the deploy in-iteration rather than
    backgrounding it. I once held it 18 minutes and blocked another agent for three of their iterations
    while blaming them for holding it.
11. **Never infer lock ownership from another agent's status file.** "TAKING NOW" is an intention; the
    lock's mtime against your own actions is the fact.
12. **If you write a task out for another agent and then do it yourself, deleting the note is part of
    doing it.** I caused a duplicated fix that way.
13. **Do not diagnose by writing to production.** `INQ-2012` is the standing reminder.
14. **Prefer `/api/tools/*` and `/api/group/tool` over chat.** Every chat turn leaves an `active`
    session row behind; that is how 11 became 90.
15. **Assert the route you landed on, not the one you asked for**, and **never trust an existing
    session** - a reused Chrome profile authenticates you as whoever ran last, and the symptom looks
    like a routing bug. Clear cookies over CDP before signing in.
16. `pkill -f` does not work in git-bash on Windows. Use PowerShell CIM filtered on both the debug port
    and the scratchpad id. Reuse one Chrome profile.

Reusable harnesses in the scratchpad: `errpath.js` (serves the documented failure stream to the real
widget), `recover.js`, `chat.js`, `walk.js`–`walk4.js`, `transcript.js`, `sessionlist.js`, `sweep.py`,
`pdfsweep.py`.
