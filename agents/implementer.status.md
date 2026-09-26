# implementer status

What I am doing right now, and what I did last. **Overwritten each iteration** — the reasoning lives
in `agents/completed.log.md`, not here.

> Rewritten at It69 when it had grown to 234 lines and opened on iteration 54's work. Trimmed again at
> It87: "Now" had quietly accumulated six iterations of CLAIMED entries, so the file said I was
> claiming six things at once. Same drift, slower. One iteration belongs here.

## Now

- **It150 SHIPPED → T58's last two items, plus the same defect in two more guards.** Both were mine and
  both are one mistake: **an assertion locating something by looking it up again instead of using where it
  actually was.**
- **The over-slice message named a direction that cannot happen.** It asserted the slice has no `SOL-TPA`
  because otherwise it *“ran past the end of the object”* — Tampa is line **89**, Phoenix **102**, so an
  overshoot runs forward into **SOL-CLT** and can never reach Tampa. Now counts `property_code:` and requires
  exactly one: direction-agnostic, no story. Re-indenting Phoenix's close → **1 failed** with the count,
  **64 passed** with the old assertion.
- **`indexOf` judged every match by the first occurrence's context.** Planted a real instruction reusing the
  retrospective's wording, below it: **`m.index` 1 failed, `indexOf` 64 passed — the same document.** The
  guard's verdict depended on a line of the test nobody would look at.
- **Swept the class instead of stopping at two.** Eight files combine `matchAll` with `indexOf`; two more had
  it. `diagram-guide`'s bare-count ban — where it bites hardest, because the fix for the original defect was
  to write a **dated** copy of the same count (probe: old `[]`, new `["nine calls"]`). And `doc-paths` took
  the **first** mention's word on whether a doc says a path is gitignored; `SUBMISSION.md` names
  `DEMO_LOGINS.md` three times and only the first two say so.
- **A hypothesis I dropped:** that `doc-paths` passes only because untracked files exist here, which would
  mean **a red suite in a reviewer's clone**. Not a defect — `PATHISH` needs a source extension and `.env`
  does not match. **I had reconstructed `PATHISH` from memory instead of reading it.**
- **The heredoc eats `\`.** `` arrived as a backspace character in Python — second escape bug in two
  iterations, both caught by asserting the match count. **Then the same bug in JS stole three probes:** the
  regex matched nothing, both filters printed `[]`, and `[]` vs `[]` reads exactly like *“this fix changes
  nothing”*. One iteration after logging *“an empty result is not a pass”*. Mechanical form: **print the
  population before printing the verdict.**
- `agents/README.md` now carries the rule in both forms. Suite **872 / 61** green, `tsc -b` clean; three
  subject files `cmp`-identical after restore.

- **It149 SHIPPED → T60: the group-sales screen said “the general manager, the general manager at
  Solstice Tampa Bayshore”.** `engine.ts:171` hardcoded the phrase and then interpolated a helper that
  returned it again. Rendered on INQ-2002, the cheat sheet's 40-rooms-in-Tampa beat, directly above the
  verdict scrubbed of that phrase at T1c.
- **The plan filed one instance; there were nine.** I evaluated all ten inquiries before touching anything:
  **four flags with the stutter and five passes** reading *“without going to the general manager”*. Plus a
  tenth, latent: the lead-time reason, which no inquiry in the dataset can reach.
- **The phrase was policy-grounded and still wrong.** `property.general_manager` is a real named person in
  the data and every proposal PDF signs on their behalf; Policy 13 puts group authority with “Sales and the
  General Manager”. But `staff_role` has no gm tier, so the app cannot prove **that** person approved — only
  that *someone named* did. One function now returns “a named approver” and every rule calls it. The
  ceiling's sentence is byte-identical, so the two documents quoting it needed no re-capture.
- **My first guard would have made me break working code.** It swept every `human_reason` literal and failed
  on the concierge escalation matrix, which **quotes Policy 15 verbatim** and names those humans in `notify`.
  Scrubbing those would make the tool misquote its own source. Scoped to group-verdict roots, with the
  exclusion **asserted** — a case checks the matrix still cites Policy 15. *A guard I would have to break
  working code to satisfy had the wrong subject.*
- **Red-checked six ways**, each mutation alone: stutter back **4 failed**, pass branch only **1**, the
  latent lead-time string **1** (the synthetic case earning its place), demo data **1**, the two flags worded
  differently while the ban is satisfied **1**, matcher broken **2**; restored **53 passed**, `cmp` identical
  on three files.
- **Two instrument notes.** `` in a Python replacement is chr(1), and a multi-line pattern used `
`
  against a CRLF file — **both caught by asserting the match count rather than trusting `.replace()`**,
  twice in one iteration. And my first red-check loop printed **nothing** because vitest wraps its counts in
  ANSI codes: four mutations ran and restored with no evidence either way. *An empty result is not a pass.*
- **Removed a decision from Enrique's morning.** `HUMAN_INTERVENTION.md` still asked him to choose (a)/(b)/(c)
  on this wording, quoting a refusal T1c had already fixed. (b) is now done everywhere; appended at the end
  so nothing shifted, 17 pointer tests still green.

- **It148 SHIPPED → T58 (`!!`): I wrote "two lines below" and it is three. My own It146 wording, on the
  stage beat.** Fixing T57's comment trap, I told the presenter to search `property_code: 'SOL-PHX',` and
  change the ceiling **"two lines below it"**. From 103 that is **105**,
  `group_block_auto_approve_max_rooms: 35,` — the rooms cap. The ceiling is at **106**, three below.
- **The consequence is the precise trap the same paragraph exists to prevent.** Edit 105 and `allowed 15`
  still reads 15, which that paragraph defines as *the tell that the edit did not land*. I replaced a search
  that hit a comment with an offset that hits the wrong field — a new route to the identical stage failure,
  eight minutes after writing the warning about it.
- **The fix is not "say three".** An offset is a count, and counts rot the moment a field is added to that
  object — the whole lesson of the T55 pointers that shifted by +13. The doc now says to change **the
  `max_discount_auto_approve_pct` line inside that same object**, which is the only one of its name there,
  and says in a second paragraph why a distance is the wrong shape *even when it is right*.
- **Guarded the form, so a correct offset is banned too.** Any *"N lines below/down/after"* instruction in
  that document fails, with the paragraph describing the old mistake exempted by its own framing. Plus a
  positive case requiring the field to be named. Red-checked: the bad instruction back fails 1, and **a
  correct "three lines down" also fails 1** — which is the point.
- **My decoy-pointer case checked constants I had typed, not the document.** It hardcoded `[10, 54, 93]`, so
  a red-check moving the doc's *"Tampa at 93"* onto **106 — Phoenix's own ceiling, the one line the
  presenter must not be steered away from** — passed. It now parses the three numbers out of the sentence
  the presenter reads. **Seventh time this session an assertion has verified its own copy of the answer.**
  Re-run: moving a decoy onto Phoenix's line fails 1, drifting one off its line fails 1.
- Restore verified against the **fixed snapshot** rather than HEAD — the file legitimately differs from HEAD
  this iteration, so `git status` was the wrong instrument and `cmp` was the right one.

- **It147 SHIPPED: swept T57's defect as a class and found one more — the live-modification beat's After
  block was never checked.** T57's problem was the shape, not the fragment: `toContain(fragment)` proves
  nothing about *which* occurrence satisfied it. Scanned every `toContain` literal in all 60 test files
  against every file each test reads: **26 ambiguous pairs.**
- **Twenty-five are benign and saying why matters.** They are identifier-presence checks — `endSentence`,
  `classify_intent`, `loadInquiries()`, `prop_read` — where any occurrence is proof, because the assertion is
  *"this symbol is referenced"*. **One was not:** `named approver` appears twice in
  `docs/live-modification.md`, and the two occurrences are **different states of the same system** — the
  **Before** block at ceiling 15 and the **After** block at 12.
- **The live ceiling is 15, so Before satisfies the guard and After was never looked at.** After is the half
  the panel sees *after* the edit they asked for. The Tester drove it by hand once at its iteration 61 and
  nothing had checked it since.
- **Derived it instead of trusting it.** Four cases take the live sentence and substitute the ceiling and the
  gap: the Before gap must equal `17 − ceiling`; the After block must be exactly what the engine would emit
  at 12; the live ceiling must **differ** from 12, or the edit shows the panel no movement at all; and the
  price must be identical in both blocks, which is the sentence the beat builds to.
- **Red-checked four ways, all firing**: After ceiling drifting 12→13 fails 1 · the gap drifting 5→4 fails 1 ·
  the After price moving fails 1 · setting the live ceiling to 12 fails 2. Both files restored
  byte-identical. **The doc was correct — all four passed on first run — so this is the thing that would
  have caught it changing.**
- My first scan only read `it.each([...])` lists and found **one** pair. The same narrow-pattern mistake, so I
  widened it; the wider sweep is what found this.

- **It146 SHIPPED → T57: the live-modification guard checked the file, not the object, so SOL-PHX's two
  numbers could change and the suite stayed green.** `walkthrough-quotes.test.ts` pinned five fragments of the
  snippet the panel watches Enrique edit and asserts each appears *somewhere in* `thresholds.ts`. **SOL-TPA
  carries the identical pair** — `group_block_auto_approve_max_rooms: 35` and
  `max_discount_auto_approve_pct: 15` — so Tampa alone satisfies the value assertions and Phoenix could
  read anything.
- **Why that is worse than a normal stale guard.** The beat's whole tell is *"'allowed 15' stays 15"*. If
  Phoenix's ceiling drifted, the doc would show the panel a snippet reading 15 with a *"change to 12"* marker
  and the presenter's only signal that the edit took would already be wrong — **on the one beat the brief
  says they will ask for.**
- **And the anchor landed on a comment.** `'SOL-PHX': {` matches the header comment at line 10 before the real
  object at 102 — the same shape as T55's boundary: **anchor on a string that exists once and assert the
  count.** The guard now anchors on `property_code: 'SOL-PHX',`, which occurs **exactly once**, slices back to
  the enclosing brace and forward to the close, and asserts the four value fragments **inside that slice**.
- **Verified every count T57 gave, independently — all five exact.** `'SOL-PHX': {` ×2 (comment 10, object
  102) · `property_code: 'SOL-PHX',` ×1 · `property_name` ×1 · `max_rooms: 35,` ×2 (**92 Tampa**, 105 Phoenix)
  · `max_discount_auto_approve_pct: 15,` ×4 (10 comment, 54 Austin, **93 Tampa**, 106 Phoenix).
- **And proved the old guard would have passed the bad edit**, rather than asserting it: change Phoenix to 20
  and the file still holds three copies of `…: 15,`, so the file-wide `toContain` was satisfied by the
  comment, Austin and Tampa. The claim is now measured, not inherited.
- **Red-checked four ways, including the one that must NOT fire.** SOL-PHX ceiling → 20 **fails** (it passed
  before) · SOL-TPA ceiling → 20 **still passes**, because Tampa is not this beat · Phoenix renamed to
  another city **fails** · a third `'SOL-PHX': {` appearing **fails**, which is the case protecting the
  anchor from becoming ambiguous later. `thresholds.ts` restored byte-identical.
- **Two more cases guard the slice itself**: it must not contain `SOL-TPA` — if it ever runs past the object's
  close, Tampa's identical pair silently satisfies everything again — and the first `'SOL-PHX': {` must still
  be a comment line, because that is the trap the document warns the presenter about.
- **The doc now names a search string with one match.** It said *"Search for `'SOL-PHX'` instead"*, and that
  search hits the header comment first — the very mistake the same paragraph warns about, and the one the
  Tester made on stage-rehearsal. It now says `property_code: 'SOL-PHX',`, and says why.

- **It145 SHIPPED: the "three places that mention it" list is complete — verified, and now guarded.**
  T56 shipped in It144. `HUMAN_INTERVENTION.md:817` tells Enrique that if he applies the `drop policy` SQL before
  submitting, the open-defect disclosure lives in **three** files: the `README.md` paragraph, the
  `SUBMISSION.md` row, and a parenthesis in `docs/where-this-goes.md`. **That list has exactly the shape of
  the one that was wrong at It139** — eight verdicts that were nine — and a list of places to edit reads as
  complete in the same way a list of corrections does.
- **The failure is asymmetric and lands at 10:55.** A place left behind means the package discloses a
  defect that has just been fixed, which reads worse than the disclosure did: a reviewer who tests the hole
  and finds it closed concludes the honesty was theatre.
- **The list is complete. Swept every tracked file, not just the Markdown** — the narrower sweep is the
  mistake I keep catching, and my first pass here *was* `*.md` only. Nothing outside the three discloses it.
  `agent/sol.md`'s **assumption 13** is the one other affected passage and correctly **not** on the list:
  the fix makes its attributability claim true, so editing it would delete a sentence that had just become
  correct.
- **Answered the question that could stop him applying a security fix at 10:55, and it needed checking:**
  **running the SQL cannot turn the suite red.** Both guards — `send-gate-bypass.test.ts` and
  `rls-policies.test.ts` — read `schema.sql` and migration 004 **from disk**, zero network calls, so nothing
  they assert moves when SQL runs in the Supabase editor. And `schema.sql` already declares **no** client
  write policy: the three policies exist only in the live database, so **the repo is already correct and
  production is the thing that disagrees.**
- **Appended that to `HUMAN_INTERVENTION.md` at the very end, on purpose** — the file is 1026 lines and the
  highest line the plan cites is **975**, so nothing above moved. Confirmed: the It142 pointer guard is
  still 17/17.
- **Guarded the list against the repo** — the It139 invariant: every file that discloses the defect must be
  named in the list. Plus a case that the guards stay hermetic, because that promise is now written down for
  Enrique.
- **My own guard failed its red-check, and the reason is embarrassing in the right way.** Dropping a file
  *from the list* passed, because **the paragraph I had just appended names all three filenames while
  explaining that the list is complete** — so a file-wide `toContain` found them in my own prose. That is
  It138's failure (a comment satisfying the check it explained) reproduced one iteration after I wrote it
  up. Now scoped to the list block. **Fifth instance of this class in my own work.**
- **And I wrote `git checkout --` into a red-check again.** The auto-mode classifier refused it as
  irreversible — correctly, since `HUMAN_INTERVENTION.md` carried this iteration's uncommitted append. Two
  earlier iterations lost work exactly that way and `agents/README.md` warns about it twice. Redone with
  three scratchpad snapshots, all taken after the fix was green.
  A named brief deliverable reported *"First signal p50 1545ms, 45ms over the 1.5s target"* from **six** turns.
  Every chat turn writes a `turn_metrics` row, so the population was available all along: **first signal p50
  1079ms — met by 421ms, not missed by 45.** **50 insertions, 0 deletions:** the six-turn tables survive as
  dated history, and the doc already superseded that confession in a later section, which is why I added the
  census rather than deleting the admission T56 asked me to remove.
- **Recomputed every figure myself, and one of them changed the headline.** T56 recommended publishing *"met
  at p50 (1079ms) and p90 (1488ms)"*. My p50s match it exactly; **its p90 of 1488ms is neither percentile
  convention.** Nearest-rank gives **1502ms — 2ms over** — and linear interpolation **1492ms**, because
  **34 of 338 turns (10.1%) exceed 1500ms**, which puts the p90 precisely on the boundary. So the doc says
  **"met at p50, level at p90"** rather than picking the side that reads better. Publishing 1488 would have
  been the same error as publishing 1545, pointed the other way.
- **First prose token is over at p90 either way** — 4321ms nearest-rank, 4299ms interpolated, ~300ms past a
  4s target, 52 of 338 beyond it. Stated, not rounded inside.
- Both framings published, since the tables print *"none"* for a tool-less turn: **33 of 338 called no tool
  and for all 33 `first_event_ms == first_token_ms`**; restricted to the 305 that did, p50 1102ms / p95
  1806ms. The three published targets are untouched.
- **Guarded the cause, not the numbers**: a section reporting a **measured** percentile must state its
  sample size. That is what both of this doc's errors had in common — a p95 from 20 calls and a p50 from 6
  turns. Measurements stay free to change; `doc-citations.test.ts` pins the targets because those are
  commitments.
- **My first guard was over-broad and my next mutation missed.** The pattern matched the bare word `p50` and
  flagged three sections that only state *targets* — no sample size exists for a commitment — so it now
  requires a figure and excludes `≤`. Then MUT 2 passed because my replacement string used `\n` against a
  **CRLF** file: a no-op, not a surviving bug. Third time this session the probe was at fault rather than
  the guard.

- **It143 SHIPPED: drove the Tester's one still-unverified FIXED-PENDING beat on production — R55006's $45
  minibar escalation. The central claim holds; two things it promised are not on the screen it points at.**
  It60's FIXED-PENDING was already closed by its own iteration 61 (PR #102's curl, 403 as promised). It59's
  was not: the row had been rewritten from one mechanism to another and **nobody had driven the replacement.**
- **The central claim is now measured and it is the strongest part of the beat.** Three chips appear —
  `get_reservation`, then `check_comp_authority` reading **"$45.00 — inside front desk authority"**, then
  **`create_escalation` to `agm`**. The threshold says `escalation_required: false` and **an escalation is
  created anyway**, from R55006's own `internal_notes`. The interviewers' own data doing the overriding.
- **Two promises were not where the row said.** Sol's prose names **neither figure** — *"I can't remove that
  myself … I've flagged it for the AGM at Solstice Tampa Bayshore today"* — while the row claimed *"Sol
  confirms the amount is inside the $50 per-stay front-desk authority."* And the itemised arithmetic the row
  said *"the tool prints"* is **real but in `human_reason`**: the model reads it and the supervisor trace
  shows it, while `chat.ts`'s done event sends only `summary` and `citations` to the bubble.
  **Same distinction as It128's "cites Policy 1" — true via the chip, not the prose.** A presenter pointing
  at the wrong part of the screen is worse than a wrong sentence, because the panel looks where he points.
- **The row now says where to look**, quotes what Sol actually says, and notes that the second charge
  **updates the same escalation** rather than opening a second — measured, same id both turns.
- **Guarded so the code can free the wording**: while `chat.ts` does not send `human_reason`, the cheat sheet
  may not say the tool prints the arithmetic; if someone surfaces it, the ban lifts. Plus a ban on the
  Sol-says-$50 claim and a requirement that the row still names the chips. Red-checked three ways.
- **I left one chat session behind** (`43e5534b`), three turns, per It138's rule to say so. Six hours before
  `demo:tidy` runs, so well clear of its thirty-minute floor. No Telnyx spend.

- **It142 SHIPPED → T55: `intervention-routing.test.ts` now resolves the plan's pointers into
  `HUMAN_INTERVENTION.md`, not just that file's own opening region.** Six of the Planner's eight had rotted
  **uniformly by +13**, including the one under Enrique's item 1 — *"the SQL to paste is at 596"*, where 596
  had become prose about GM sign-off. The two survivors were the two inside the region the old guard
  covered. **It had learned the lesson about the file it lives next to, not about the file that cites it.**
- **Checked my own citations first, by hand.** `doc-paths.test.ts`'s CITED table and the `plans/01`–`04`
  corrections all cite `HUMAN_INTERVENTION.md:122`. **It is still the 10DLC line** — the thirteen lines went
  in below it. A green suite would not have proved that; a coincidental match at 122 looks identical.
- **Two details the task's own wording would have led me to get wrong**, both caught by probing rather than
  reading:
  - **The boundary must anchor at line start.** `## 0. Verification log` appears at plan line **597**, inside
    T55's own description, before the real heading at **1962**. My first probe used `indexOf` and checked
    **7 of 12** pointers while looking thorough. The guard now asserts the phrase occurs *before* the
    heading, so the anchor is tested rather than remembered.
  - **Emphasis must be stripped before comparing.** The plan quotes `:27` as *"Neither the Tester nor I
    **will** delete production rows"* — bolding the word carrying the argument. The source says plain
    `will`, so a literal match fails on a faithful quotation.
- **The log exemption is load-bearing, and the guard proves it**: four pointers down there do not resolve,
  because the log quotes them as they were. Without the exemption this would fire on dated history — the
  cry-wolf failure `suite-integrity.test.ts` already warns about — so a case asserts at least one of them
  is stale.
- **Red-checked with the real failure rather than T55's suggested one.** Instead of decrementing a number in
  the Planner's live file — dirty at that moment — I inserted **13 lines after line 100 of
  `HUMAN_INTERVENTION.md`**, which is what actually happened. **5 failed**: four of my new plan-pointer
  cases plus the pre-existing in-file one, and **`:27` and `:63` correctly did not fire** because they sit
  above the insertion. That is the incident's exact signature. Restored byte-exactly, confirmed by
  `git status` showing the file clean.

- **It141 SHIPPED: swept all 25 Today-page nodes instead of one claim. 22 held, 5 newly verified, 1 overclaim.**
  Three passes had each found exactly one wrong thing here — It133 the statuses, It135 the storage overclaim,
  It140 the call count — and **each had found only what it went looking for.** So this time the whole page.
- **The secret boundary is now proven, not asserted.** `y_env` claims only `SUPABASE_URL` and the anon key
  reach the bundle. Fetched all three deployed assets — **1.09 MB** including a lazy chunk the first pass of
  my own grep mislabelled as absent — and scanned: **zero occurrences** of the service-role key, Telnyx key,
  Anthropic key, tool secret, proposal secret, demo password and SIP password; **exactly one JWT, and its
  `role` is `anon`**; no `KEY…`-shaped, `gencred…` or `sk-ant-` strings anywhere.
- **Four more checked clean**, each against the thing it describes rather than the notes: the Realtime list
  against the **five `useRealtimeMerge` call sites** (`sessions`, `messages`, `tool_invocations`,
  `inquiries`, `proposals` — exactly those); the net-new tool's `simulated_inventory_service` stamp;
  the RLS refusal the Tester measured as a **403** with that reason; and the build description against
  `package.json` and `netlify.toml`'s `/api/*` rewrite.
- **The overclaim: `y_envl`.** It said *"ok, grounded, citations, masked_fields, latency_ms **on every tool
  without exception**."* `shared/types.ts` marks **`citations?`, `masked_fields?` and `latency_ms?`
  optional**, and `availability.ts` and `lookups.ts` return no citations at all — two of the five are not
  universal. **`latency_ms` turned out to be**: the registry wrapper stamps it on the success, error and
  spread paths alike, and every production row carries one. So the sentence keeps *"without exception"* for
  the three that earn it and says *"where there is something to cite or mask"* for the two that do not.
  **The envelope's whole value is that you can always tell whether an answer was grounded** — claiming more
  than that weakens it, because one tool without citations costs a reviewer their belief in the rest.
- **Guarded against the type, not against a string**: whatever the node calls universal must not be declared
  optional in `shared/types.ts`, and the three that are guaranteed must still be claimed. Red-checked both
  ways — restoring the five-field version fails 1, dropping the earned claim fails 1.
- I nearly concluded `y_rtm` was wrong: my first grep for `table: '…'` found **one** table, because the
  hook takes the table as a parameter. Tracing the call sites gave five. That would have been a fabricated
  finding, and the difference was reading the code rather than the grep.

- **It140 SHIPPED → T54: "Six calls transcribed" was my own It133 sentence, and the six was my `limit=6`.**
  The `/api/telnyx/events` node on the diagram's Today page said *"Six calls transcribed."* I wrote that at
  It133 from a query I ran as `&order=started_at.desc&limit=6` — **I reported the limit I had typed, not the
  count.** Third wrong figure found on that page after It133's statuses and It135's storage overclaim, and
  the third understating one.
- **The shape is the real fix, not the number.** It131 converted every count in `README.md` to a floor, a
  command and a test; **the diagram was never part of that pass.** The other raw count on the page, *"25
  tools"*, can stay a number precisely because the export-parity guard holds it still — this one moves every
  time anyone dials. And "calls" is ambiguous: two of the sessions are `taken_over → ended` pairs a minute
  apart, so nine sessions could be seven, eight or nine calls. State the **invariant** instead.
- **Measured with no `limit`: `Content-Range: 0-8/9`.** Nine voice sessions, **all nine carrying turns**
  (3 to 53), two of them `taken_over`. The node now states the invariant — *"Every voice session to date has
  a transcript: nine of nine as of 2026-09-26, two of them handed to a supervisor mid-call"* — which says
  more than the tally did and dates itself instead of pretending not to. **"25 tools" left alone.**
- **The same six had propagated into `docs/README-diagram.md:43`**, which T54 did not mention: *"six phone
  calls are in Postgres with their transcripts."* Same It133 sentence, two files. Fixed, with the reason
  written down where the claim lives.
- **Guarded by shape, not by value.** The Today page may not state a bare count of calls, sessions,
  transcripts, messages or turns unless the sentence dates itself or states an invariant — so **even
  *"Nine calls transcribed"*, which is correct, fails.** Plus a case tying *"25 tools"* to the committed
  export, because "it is allowed to be a number because it is pinned" is only an argument if something
  checks it. Red-checked three ways; all three fire.
- **I lost the fix mid-red-check and the restore put back the unfixed file.** It135's rule says copy to the
  scratchpad instead of `git checkout --`; I did — but I took the copy **before** the edit, so every restore
  reverted it and the last one left it reverted. Caught by the *restored* line reading **2 failed**, which is
  the only reason the red-check ends with a restore and a re-run. `agents/README.md` now says to snapshot
  **after** the fix is green and to name the copy for the state it holds.

- **It139 SHIPPED → T53: the ninth of the eight verdicts I corrected at It125.**
  `plans/05-requirements-audit.md` marked **D1** — *"explain clearly to BOTH technical and non-technical
  stakeholders"*, one of the brief's six criteria — **PARTIAL** for the reason *"no rehearsed narrative tying
  them together."* **My own It125 sweep moved eight verdicts and never touched this one.** Verified: D1
  appears **0 times** in the block I wrote. The incomplete-sweep pattern, in my own work this time.
- **The reason was closed by the most explicit artifact in the package.** `docs/demo-runbook.md` line 3, the
  first sentence in the file: *"Written for two audiences in one room: a director of engineering and a
  non-technical product owner."* Marked **DONE**, with the evidence in the row.
- **T53 said "eight scripted `Say:` beats". Measured: 11** — and my own first count said **4**, because I
  grepped for `**Say` and three specific phrasings instead of the word. Second pass over `\bSay\b` found
  eleven, plus something better than a cue count: beat 6 is titled ***"Cost, for the product owner"***. Two
  wrong counts of the same thing before the right one, and the fix both times was to stop pattern-matching my
  own guess.
- **The guard is the general rule, not the row.** `doc-paths.test.ts` now requires **every row still marked
  PARTIAL below the block to be named in the block** — C8, D1, D3, D5, D6 today — which is the invariant that
  would have caught this in the first place, because a list of corrections reads as complete. Plus the
  heading's spelled-out count must match the number of rows; it said *eight* over nine. Red-checked three
  ways: removing the D1 row fails 1, reverting the heading fails 1, deleting the block fails 5.
- **7 insertions / 1 deletion**, and the deletion is the heading inside my own block — the 2026-09-24 body
  is **byte-identical to HEAD**.

- **It138 SHIPPED: "Running it locally" told a reviewer to run three commands they cannot run, and one of
  them crashed.** Staying on It137's angle — what a reviewer actually *does* rather than what the docs
  claim — the next thing they do after the suite was the block at `README.md:263`:
  `npm install` → `cp .env.example .env  # then fill it in` → `npm run db:schema` → `npm run db:seed`
  → `npm run seed:users` → `npm run dev`.
  **They cannot fill it in.** No Supabase project, no Anthropic key, no Telnyx account. So three of those
  six steps cannot work for them, and the block does not say so — a reviewer who follows it in order hits
  three failures and reasonably concludes the project does not run, while the live site sits there working.
- **Tested in the reviewer's actual state, not with my `.env`** — only in the scratch copy of the tracked
  tree, where `.env` is gitignored and therefore absent. `db:seed` against a filled-in `.env` would write
  to the production database, so that mattered. Measured there:
  `db:schema` prints the three ways to apply the schema · `db:seed` names the variables and where to get
  them · **`seed:users` died on an unhandled `ENOENT` with a stack trace and an absolute path** — and its
  own correct checks were sitting two lines below the crash, because it read `.env` with an unguarded
  `readFileSync`.
- **The guard then found three more the grep had missed**, one of which matters: `demo:tidy`
  (`cleanup-phantom-sessions.mjs`) is in `SUBMISSION.md`'s pre-send checklist and is run minutes before
  submitting. Also `check-email-domain.mjs`, `export-voice-transcript.mjs`, and
  `telnyx/export-assistant.mjs` — whose own header says it exists *"so a reviewer can see the actual agent
  configuration."* All five now use `loadEnv()` from `scripts/data/lib/env.mjs`, which already solved this,
  and all five refuse with the variable name instead of a trace.
- **`README.md` now splits the block**: four commands that work on a bare checkout with no credentials
  (`npm install`, `typecheck`, `npx vitest run`, `data:check` — all verified exit 0 there), then the
  credential-dependent steps under a sentence saying you need your own Supabase, Anthropic and Telnyx.
- **Two of my three red-checks passed when they should have failed, and both were the guard's fault this
  time.** `guarded` tested `src.includes('loadEnv')`, which **the comment explaining `loadEnv` satisfies by
  itself**; and the early return required a quoted `'.env'` or `process.env.` with a trailing dot, so
  `cleanup-phantom-sessions.mjs` — whose reader is now `const env = process.env` — **exempted itself**.
  Both conditions written from one example, which is the fourth instance of that pattern this session and
  the first where the red-check found it in my own guard rather than in someone's prose. Fixed to match
  code rather than prose; all three now fire.
- **`doc-citations` caught the knock-on**: adding lines to `cleanup-phantom-sessions.mjs` moved
  `docs/demo-runbook.md`'s `:109` citation. Re-pointed at **`:113`, the `const STALE_MINUTES` declaration
  rather than the comment above it** — a const moves only when the code does.
- Clone: **822 / 58 files**. Bare checkout, no `.env` and no `.git`: **817 passed, 5 skipped, 0 failed.**

- **It137 SHIPPED: a reviewer who downloaded the ZIP instead of cloning got three failed test files — one
  of them the credential guard.** `README.md` tells a reviewer to run `npx vitest run`
  *"for the live number"*, and It131's floors exist so they can check our counts themselves. **Three tests
  shell out to `git ls-files`**: `no-committed-credentials.test.ts`, `suite-integrity.test.ts`, and
  `repo-floors.test.ts` — the last one mine, from It131.
- **Reproduced it properly rather than reasoning about it.** Copied the 262 tracked files to a tree with
  no `.git`, junctioned `node_modules`, ran the three: **3 failed files, `Tests no tests`.** They do not
  fail an assertion — they fail to *collect*, so `no-committed-credentials` loses **12 security
  assertions** and reports a git error instead of a credential result. GitHub's "Download ZIP" is a
  completely ordinary reviewer path.
- **First attempt at the repro was wrong and I nearly believed it.** A `git` shim on `PATH` returned green
  — Git Bash's POSIX `PATH` never reached Node's Windows process lookup, so the real git ran. Same lesson
  as It133: a check that stays green means the guard holds **or** the probe missed.
- **The fix, measured both ways.** `shippedFiles.ts` prefers `git ls-files` and falls back to a
  `.gitignore`-aware walk. Before: **3 files failed to collect, `Tests no tests`.** After — **clone: 809
  passed / 58 files. No `.git`: 804 passed, 5 skipped, 0 failed.** The 5 skips are the checks that
  genuinely have no meaning outside a clone, each saying so in its title.
- **`suite-integrity` skips rather than falling back**, because *"committed but missing from the working
  tree"* cannot happen in a ZIP — the archive **is** the tracked set. Faking a fallback there would have
  invented a result.
- **The first draft of my own new guard asserted "we are in a clone"** and was the single remaining failure
  in the no-git run — a guard that assumed the thing I was removing the assumption about. Now `skipIf`.
- **`README.md`'s floors block gains one clause**: the five `git` lines need a clone, and `npx vitest run`
  checks every floor either way. `agents/README.md` gains the rule — **never shell out to `git` from a test
  without a fallback**, because the failure lands during *collection*, so the tests do not fail, they
  never run.
- **Red-checked four ways, and one of them lied first.** Removing `node_modules` from the hardcoded
  exclusions stayed green, because `.gitignore` re-adds it — the guard was fine, the mutation was
  ineffective. Cutting **both** sources fails 1. Also: the walk returning nothing fails 2, dropping the
  exact-name rules so `.env` and `DEMO_LOGINS.md` would be scanned fails 1, and preferring the walk inside
  a clone fails 1. Third time this session that a green red-check was my probe rather than the guard.

- **It136 SHIPPED: `docs/architecture.svg`'s own guide promised "nothing under 12px". Its smallest text was
  the 52 TODAY/FUTURE tags at 11.** T52 shipped in It135, the Planner's 03:24 banner
  predates the merge. The SVG is the diagram a reviewer actually *opens* (an `.svg` renders in a browser;
  a `.drawio` needs diagrams.net), and `docs/README-diagram.md:6` makes three falsifiable promises about
  it: *"Nothing under 12px, black-on-white contrast, and no meaning carried by colour alone."*
- **Measured all three.** Contrast holds — every text fill is **5.05:1 to 18.69:1** against white. Shape
  holds — 40 dashed rects against 35 solid, and the **31 `9 5`-dashed borders match the 31 FUTURE tags
  exactly**, so the distinction survives without colour. **The font size does not:** `viewBox="0 0 2500
  1670"` with `width="2500"`, so units are 1:1 pixels, and **52 `<text>` elements sit at `font-size="11"`
  — 31 FUTURE and 21 TODAY, nothing else in the file.**
- **The irony was the substance.** The smallest text in a file *"sized for a projector"* was the text
  doing the accessibility work: the tags are the thing that stops the TODAY/FUTURE distinction being
  colour-only. **Fixed the SVG rather than weakening the claim** — tags sit 380–420px apart, so 11 → 12
  costs ~5px of width and cannot overlap. **52 substitutions, 52/52 diff, XML re-parsed**, nothing under
  12 left.
- **Guarded all three promises, computed not asserted**, in `diagram-guide.test.ts`: a size floor over both
  attribute spellings; **WCAG relative luminance** for every `<text>` fill, with a prior check that no
  text uses a light fill so white really is the backdrop; and **31 dashed borders must equal 31 FUTURE
  tags**, which is the per-node version of It134's label-versus-shape mismatch. Red-checked four ways —
  one tag back to 11 fails 1, one FUTURE node drawn solid fails 1, one label greyed to `#C9C2B8` fails 1,
  the guide dropping the promise fails 1.
- **Restored every mutation with `cp` from the scratchpad**, which is It135's lesson applied the same
  night rather than a note for later.
- The guide now carries the measured numbers beside the promises, the way the README's floors do.

- **It135 SHIPPED: T52 — the same diagram page's one *over*statement, and it was the security claim.**
  It133 and It134 swept this page and the in-app map and found 26 wrong markings, **every one an
  understatement.** T52 is the mirror image: the Today page said proposal PDFs are handed out as
  ***"time-limited signed URLs."***
- **Measured with no credentials at all**, before rewording anything: `/object/public/proposals/PRP-2011/
  <32 chars>/<file>.pdf` → **200, 2,570 bytes, `application/pdf`**. No `token=`, no `/sign/`,
  `getPublicUrl` in `store.ts` rather than `createSignedUrl`. **Nothing is signed and nothing expires** —
  the protection is an unguessable path that never stops working.
- **The reason it mattered is that `README.md` already gets it right**: *"a capability URL, not an
  authenticated download … no expiry and no revocation."* So the package **volunteered the weakness in one
  deliverable and claimed the stronger mechanism in another**, and a reviewer reading both had to pick.
  The Today node now carries the README's own framing. **One line, 1 insertion / 1 deletion.**
- **The Future-state node is untouched on purpose** — *"Amazon S3 with time-limited signed URLs … Today:
  Supabase Storage"* is correct, marked FUTURE, and is the contrast that made the Today node a borrowed
  phrase rather than a misunderstanding. The guard protects it too, so "fixing" the failure by deleting
  the recommendation does not work.
- **The guard bans the claim, not the phrase.** It reads `store.ts`: while the code calls `getPublicUrl`,
  the Today page may not say *signed* or *time-limited*; if someone genuinely implements signing, the
  branch flips and the wording is allowed. It also requires the README and the diagram to keep agreeing,
  since the disagreement was the finding. Red-checked three ways — the overclaim restored fails 2,
  deleting the FUTURE contrast fails 1, the README dropping its limit fails 1.
- **A process mistake worth recording: `git checkout -- <file>` between red-checks threw away my own
  uncommitted fix**, and the "restored" line came back **2 failed** instead of green. That is what caught
  it. Re-applied from the script and redid the whole red-check with scratchpad backups, which is what
  `agents/README.md` already says to do and what I stopped doing because `git checkout` was shorter.

- **It134 SHIPPED: the in-app Backend map had the same disease as It133's diagram, on the screen Enrique
  narrates to the panel.** `docs/README-diagram.md` says the two diagram files and the
  in-app Backend page are *"built from the same component model"* — so once the `.drawio` turned out to be
  a day stale on status, the live version was the obvious next place to look. It is worse:
  `backendMapModel.ts` carries **16 `pending` and 6 `blocked`** nodes, and only **two** of them are true.
  **`Claude` is `blocked`. So is `API key`, `Phone number + Call Control`, and `AI Assistant "Sol"`.** All
  four work; I verified them against the live systems in It133, minutes ago. `/api/chat`, the chat runtime,
  the voice runtime, `/api/telnyx/events`, `call.ai_gather.message_history_updated`, the email API, the
  delivery adapter, the assistant-config export and Mission Control are all `pending` too.
- **This is beat 7.** The runbook has Enrique put this map on screen and narrate it to the technical panel.
  A reviewer who reads the dots sees a system where the model, the key, the number and the voice agent are
  all blocked. Only `SMS (10DLC)` and `10DLC registration` are correctly marked.
- **Twenty nodes promoted, two left blocked, evidence per node.** The map is now **65 live / 0 pending /
  2 blocked** and the only blocked pair is 10DLC. Two new live reads on top of It133's: the WebRTC
  credential `solstice-supervisor-webrtc` is **unexpired** and the connection *Solstice FDE - Supervisor
  WebRTC* is **active**, which is what the browser supervisor leg needed.
- **I did not let the ladder round up.** It is live — a session is `taken_over` — but the supervisor hears
  the **guest, not Sol**, and the README says so precisely. A live badge with no caveat would have
  overstated the one thing in the package deliberately described as partly working, so **the limit is now
  in the node's own detail line**, where a panellist reading the map sees it. Guarded.
- **`backend-map-status.test.ts`, 13 cases**, pinning the invariant rather than the audit: nothing may be
  `pending`, because pending means *waiting on an account* and nothing is; `blocked` must be exactly the
  10DLC pair; six named nodes must be live; and **the map and the `.drawio` must agree**, which is the
  claim `README-diagram.md` makes and the one that would have caught either file from the other.
  Red-checked four ways — pending fails 3, `Claude` back to blocked fails 3, dropping the ladder limit
  fails 1, a `PENDING` back on the `.drawio` fails 1.

- **It133 SHIPPED: the architecture diagram's "Today (MVP)" page said the demo does not work.** Nothing was
  open, so I audited the last two unaudited deliverables. `docs/where-this-goes.md` came back **clean** —
  including *"twenty minutes … the number in their own brief"*, which I checked against the PDF: the brief
  says *"a request that should take twenty minutes takes two days."* Then `docs/README-diagram.md` led me
  into `docs/architecture.drawio`, **a named brief deliverable**, and its Today page — the page whose whole
  job is *"what actually runs at the demo"* — carries **six wrong status markings**, every one understating
  the build:
  - `y_claude` **BLOCKED** — *"Key is not workspace-scoped and currently 400s. Code is written against the
    contract."* The chat brain. **It answers on production.**
  - `y_sol` **BLOCKED** — *"Blocked on account funding."* Provisioned at 29,784; live calls have been made.
  - `y_ph` **PENDING** — *"Waiting on account funding."* The number is bought, attached and **printed in the
    README**.
  - `y_chat`, `y_ev`, `y_em` **PENDING** — `/api/chat`, the transcript webhook, and an email that has
    actually been delivered.
  Only `y_sm` (10DLC) is correctly BLOCKED, and **its stated reason repeated the premise I corrected in
  It127**. A reviewer opening this page read a diagram saying the centerpiece is a mock, attached to a
  README saying it works. **The contradiction is worse than either half.**
- **Verified every promotion against the live systems, not the notes**, before changing one label:
  Anthropic `POST /v1/messages` → **200**, `claude-sonnet-5`, 9/4 tokens · `+13057866217` **active**,
  connection *Solstice FDE - Sol Voice* · assistant `anthropic/claude-haiku-4-5`, **29,784** chars,
  **25** tools · **six voice sessions** in Postgres carrying **3–9 transcript messages** each, one
  `taken_over` · sending domain `enriquecodes.com` **`status: verified`** with DKIM · **four proposals**
  `status: sent`, `sent_via: email`. The page is now **24 LIVE / 0 PENDING / 1 BLOCKED**, borders moved
  with the labels, legend rewritten, and SMS given the reason that is actually true — nothing was ever
  registered, so the clock never started.
- **Guarded three ways in `diagram-guide.test.ts`**: the counts the guide now states out loud must match
  the page; **every tag must be backed by its border shape**, which is the promise the guide makes and the
  thing this fix had to change in two places at once; and the two false reasons are banned by name.
- **One red-check did not fire, and the guard was fine — my mutation was.** Flipping the first `dashed=0;`
  in the file hit a cell outside the Today page, so the shape case passed. Re-run against `y_land`
  explicitly it fails 1. Worth writing down: *a red-check that stays green means the guard is broken **or**
  the mutation missed*, and those need telling apart before either is believed.
- Also: `AGENTS.md`'s own It119 correction block said the email path worked *"with Telnyx's sandbox domain
  the only limit"*. The domain is a **verified custom** one. **A correction block that has itself gone
  stale** — the fifth instance of a stated principle outliving its implementation.

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
