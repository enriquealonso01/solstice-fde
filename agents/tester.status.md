# tester status

Read this cold and you should know what to do next. The permanent record is `agents/tested.log.md`
(~2600 lines); this file is only the working state. Per-iteration narrative has been trimmed out of
here on purpose — it is all in the log.

> Use Write, not `printf >`, on this file. Iteration 17 truncated it that way.

---

## State: iteration 27 complete. NOTHING OF MINE IS FIXED-PENDING. No lock held.

Everything I have shipped has been re-tested by a later iteration and marked VERIFIED.

---

## Do next, in order

1. **G17 masked tool traces, re-checked after 27 iterations of new traffic.** Verified at iteration 3
   across 169 rows; the table is far larger now and has had voice, group and chat writes since. Free:
   pull `tool_invocations`, confirm the column is still `args_masked` with no `args`, and regex for
   emails / phone shapes / `9945` (R55012's real card last-four).
2. **Role scoping re-checked below the app.** Iteration 3 proved RLS per JWT via PostgREST. Several
   schema-touching PRs have landed since. Same test, ~2 minutes, and it is the claim a security-minded
   panellist is most likely to probe.
3. **The rendered-output sweep, re-run.** `scratchpad/sweep.py` + `pdfsweep.py` exist and are honest
   (they count what they read and fail on zero). Re-point them at verdicts / follow-ups / escalations
   / PDFs after any content change.
4. **The supervisor transcript screen with a real conversation open.** Iteration 11 confirmed it
   renders; nobody has checked a transcript reads correctly end to end on screen, and it is the one
   admin surface the demo dwells on.

---

## Blocked, needs Enrique — all in `HUMAN_INTERVENTION.md`

- **Beat 5 / T5 failure injection.** This session refuses `/api/flags` **reads and writes**
  (auto-mode classifier, `[Feature Flag Writes]`). The runbook calls this "the moment they will
  remember" and I cannot walk it at all. Either allow that endpoint or flip `pms_offline` yourself for
  two minutes and I will observe.
  **R55012 is the wrong fixture** — it is checked out, so the refusal lands on dates before the PMS is
  consulted. **Use R55022** (Zhang, check-in 2027-03-12), the one booking far enough ahead to exercise
  live paths.
- **Beat 3 cannot run.** The runbook's own pre-flight demands Telnyx > $20; balance is **$3.09**. That
  is 4 of ~18 minutes and the split-screen moment. Top up, or present it from the real call in
  `transcripts/`. Either is fine; drifting in without choosing is not.
- **Delete `INQ-2012` and `INQ-2013`.** Mine, from testing. Beat 4 says "click it from the inbox list"
  and that list shows 13 rows including **"Vantage Labs DELETE-ME"**. No DB write access here.
- **Chat cannot open a group inquiry.** `create_inquiry` is absent from the chat registry while
  `solPrompt.ts:69` instructs it. Three pieces of evidence: the Sales inbox delta is 0, a prompt-level
  workaround took two attempts to stop leaking, and the resulting escalation is miscategorised as
  `other`/agm while the guest is told "Sales". `registry.ts:184` exists for exactly this. Your call; I
  have not made it.
- **Warm the site before the panel arrives.** Tool webhooks are p50 196ms / p95 304ms, but the
  **first** call after idle was **1310ms** — a cold start, ~4x the published p95. One request a minute
  before you start. No code change.
- Open question, not a defect: "the general manager" is not a role (`concierge|group_sales|admin`), so
  group sales can approve past the ceiling. Documented honestly in the README by PR #21.

---

## Shipped by me, each re-verified by a later iteration

| PR | What was wrong |
|---|---|
| #7 | Chat told guests "a colleague is joining this chat now" when nothing was |
| #14 | A failed chat turn showed the guest **nothing** — `error` then `done`, and `done` overwrote the failure |
| #22 | A phoned-in inquiry listed **twice** in the sales inbox |
| #24 | "Will I be charged if I cancel?" answered wrongly **twice out of two**, on money |
| #28 | Chat told guests "I don't have a create_inquiry tool available" (3/3 → 1/3 → 0/4) |
| #33 | "passing this to **the the** Boston-area sister property" in the verdict beat 4b shows |
| #36 | Proposal PDF read "Alumni Assoc**..** Reference" — plus 4 latent sites |

Also repaired, not code: regenerated PRP-2007's persisted PDF, having first proved from the source
that the regeneration was state-preserving, then confirmed row id / status / revision / all pricing
unchanged.

---

## Verified without needing a fix

Group approval gate on all four send paths including the agent's own tool with a valid secret; role
scoping at the API and below it via PostgREST per JWT; G17 masking across 169 trace rows; the PDF
access matrix and every figure against Postgres; the follow-up gate including
approve-then-swap-the-words; T2 the whole app as a stranger; the chat widget driven in a real browser;
`docs/latency-target.md` re-measured independently; every policy number and all five guest rows in the
cheat sheet; beat 4a to the cent ($7,994.25) and beat 4b (−395 quarantined, a referral to a hotel that
genuinely is not in the directory); other agents' PR #11, #20, #25.
Guardrails with evidence: **G7 G8 G9 G10 G12 G13 G14 G15 G19**.

---

## Method rules, each learned the hard way

1. **"Exit 0 and no output" is not success.** A canceled deploy reported 0 because the pipeline ended
   in `head`. Never pipe `netlify deploy` — run it bare, read its own exit code, and confirm with
   `netlify api listSiteDeploys`.
2. **Verify at the surface a human touches, not the layer you changed.** Twice the code was fixed,
   deployed and green while the artifact a person opens was still wrong (canceled deploy; stale PDF).
3. **A test or control that silently does nothing looks exactly like a pass.** Three instances: a
   handler test that returned early on a 503, a revert that never applied, a PDF sweep that declared
   clean having read zero files. Make instruments count what they examined and fail on zero.
4. **Read the sentence, do not grep it.** Seven false alarms. A phrase list cannot tell a promise from
   a refusal to make one, nor transcript history from a live banner.
5. **Any apparent encoding defect is my own pipeline until proven at byte level.** Wrong three times;
   Windows Python reading curl output mangles UTF-8 as cp1252.
6. **Model output needs repeats.** PR #26 passed run 1 and leaked run 2. Three or four runs minimum
   before believing a prompt-level fix.
7. **Read the artefact, not the diff.** A pre-merge draft line in a commit nearly had me file a false
   report against the README.
8. **Do not diagnose by writing to production.** `INQ-2012` is the standing reminder.
9. `pkill -f` does not work in git-bash on Windows — it silently matches nothing and orphaned four
   headless Chromes. Use PowerShell CIM filtered on both the debug port and the scratchpad id.
10. Reuse one Chrome profile; minting one per run grew the scratchpad to 664M.
11. Do not spawn a background watcher for a backgrounded deploy — it fires its own notification, and
    the watcher outlives it and arrives later as a confusing alert.

Reusable harnesses in the scratchpad: `errpath.js` (serves the documented failure stream to the real
widget), `recover.js`, `chat.js`, `walk.js`–`walk4.js`, `sweep.py`, `pdfsweep.py`.
