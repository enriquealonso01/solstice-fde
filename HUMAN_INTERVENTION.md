# Human intervention needed

Anything an agent cannot do without Enrique. Newest at the top. Each entry says what is blocked,
what exactly is needed, and what it is blocking, so a decision takes seconds rather than
archaeology.

Agents APPEND here. Enrique clears entries once handled.

---

## Start here — the short list, 2026-09-25 15:30

There are 26 entries below and roughly half are already resolved by us and simply not cleared.
Read this block; the rest is history and evidence. Nothing here is deleted, so anything you want to
check is still under **Open**.

**Blocking a demo beat — do these two or beats 3 and 4 do not work as scripted:**

1. **Top up Telnyx. Balance $3.09; the runbook's own pre-flight requires $20.** This is not tidiness:
   the Tester walked the runbook in order and **beat 3 cannot run** — the phone call and the
   split-screen moment, about 4 of the 18 minutes. Below $20 the checklist's own instruction is
   "do not invite them to call the number", which removes the most memorable thing in the demo.
   → portal.telnyx.com, Billing. About $30.

2. **Delete two junk inquiries an agent created while diagnosing.** The sales inbox returns **13
   rows**; beat 4 tells the panel there are ten, and `INQ-2012` and `INQ-2013` sit in front of the
   real ones. Neither the Tester nor I will delete production rows the night before, so this is
   yours:
   ```sql
   delete from inquiries where inquiry_code in ('INQ-2012','INQ-2013');
   ```

**Immediately before you rehearse, and again immediately before the demo:**

3. **`npm run demo:tidy`.** The supervisor dashboard's "ACTIVE NOW" tile reads **85**, all of it our
   test traffic, growing about 25 an hour. It is the first thing a panel sees in beat 3. Takes
   seconds, closes anything idle over thirty minutes, deletes nothing. Running it earlier than
   "just before" is wasted — testing regrows it.

**Decisions only you can make, none blocking:**

4. Whether to gate `approve` on `admin`, or leave approval authority as a named human. Both
   defensible; the wording now says what is actually enforced either way.
5. The build-cost figure, if you know it. The README states the absence honestly if you do not.

**One ten-second check I cannot do:** open the live site on a real phone, tap the chat bubble, tap
the text box, and confirm the composer sits above the keyboard. Emulation cannot prove it.

**Already resolved by us — listed below only as a record, no action needed:** the phoned-in inquiry
vanishing and then double-listing, the untraced `session_id`, the chat runtime naming its own
tools, the cheat sheet's group-booking claim, the runbook's `INQ-2009` URL, failure injection
(I ran beat 5 on production), and the general-manager wording.

---

## Open

- **Telnyx balance is $3.15, and it is more urgent than the number looks.** A single ~3-second
  browser call placed to verify the mic fix moved it $3.63 → $3.15. Whatever the split between
  per-call setup fee and duration, the remaining balance is worth only a handful of calls, and a
  panel demo that opens with a dead line is unrecoverable. Needed: top up to ~$30 at
  portal.telnyx.com → Billing. Blocks: live call rehearsal, the supervisor-ladder verification
  (E1), any further voice testing, and inviting the panel to call the number.

- **10DLC registration not started on the funded account.** Needed: register a brand and campaign
  at portal.telnyx.com → Messaging. Blocks: SMS delivery of proposals. Days of carrier queue, so
  it will not clear before submission.

---

- **Judgment call: "the general manager" is not a role, and group sales can approve past the
  ceiling.** The refusal on a flagged proposal reads "…needs the general manager signing it off",
  but the schema has three roles (`concierge`, `group_sales`, `admin`) and `approveProposal`
  applies no test beyond `group_sales | admin`. The audit does record the override honestly
  (`overrode_rules: ["GRP-DISCOUNT-CEILING"]`), which is a defensible design — but the sentence
  promises an authority the system does not enforce.
  Needed: your call on one of three — (a) leave it and answer it verbally if the panel asks, it is
  a realistic scope boundary; (b) soften the refusal text to "someone with sign-off authority",
  a one-line change; (c) add a GM role, which is schema + RLS + seed work and not a day-before
  change. My read: (b) if anything; (a) is defensible.
  Blocks: nothing. Flagged because a panel that reads the refusal will ask who can approve, and
  the honest answer should not be improvised in the room.

- **Your voice rehearsal is also the last verification T1 needs — please notice when it happens.**
  I verified the mic fix as far as it can be verified for free: the old descriptor genuinely
  throws `InvalidModificationError` in real Chrome, the browser's opus entry carries
  `sdpFmtpLine: "minptime=10;useinbandfec=1"` so the old code could never have matched, the
  capability-based path is accepted, and the fixed function is in the production bundle
  (`assets/index-DfHSjaW2.js`). What I did not do is place a call: at ~$0.48 each against a
  **$3.09** balance, that is 15% of what is left for tomorrow's demo.
  Needed: when you rehearse, watch for the VoiceBar text reaching **"Listening"**, and tell me.
  That closes T1 on live evidence at no extra cost. Blocks: nothing — but until then the log says
  the *fix* is verified and the *live call* is not, and those stay separate.

- **Optional, and only you can answer it: what the build actually cost in model spend.** The new
  "What this cost to build" section in `README.md` states the measured things — about 24 hours
  elapsed with under 5 active, 40 commits across two agent phases, 211 files, 315 tests — and then
  says plainly that build-time model spend is not instrumented, rather than inventing a number.
  That is a defensible position and the section reads fine as it stands.
  Needed: nothing, unless you happen to know the figure and want it in. If you do, one line in
  that section turns a stated absence into a measured number, which is strictly stronger for an
  FDE pitch. If you do not, leave it — a made-up build cost would undercut the runtime figures,
  which are real. Blocks: nothing.

- **Pre-send checklist: two of six lines are not satisfied right now, and one is timing-sensitive.**
  I ran the whole `SUBMISSION.md` checklist read-only. Four pass: repo is public and openable, all
  three failure-injection switches are off, the live site and both admin surfaces return 200 with
  anonymous requests still refused 401, and `npx vitest run` is green at 330.
  The two that are not:
  1. **Telnyx balance is $3.15, the checklist wants $20+.** Unchanged ask, now with a date on it.
     Below $20 the checklist's own instruction is "do not invite them to call the number", which
     removes the single most memorable part of the demo.
  2. **10 sessions are still marked `active`, 6 idle over thirty minutes.** Not a defect: a browser
     tab has no hangup event, so every chat anyone opens leaves one behind, and the Tester has been
     driving chat against production all day. `npm run demo:tidy` clears them in seconds.
     **Run it last, minutes before you send or demo — not tonight.** Running it early and then
     rehearsing simply undoes it. I have put that timing into the runbook's "Before they join" and
     into the checklist itself (PR #10), because both said to do it and neither said when.
  Needed: the top-up is yours. The tidy is a ten-second command whenever you are ready, or say the
  word and I will run it at your go. Blocks: nothing today.

- **RESOLVED, no decision needed from you: the phoned-in inquiry that vanished from the sales
  inbox.** The Tester escalated this asking which way to go on the masked contact. It turned out
  not to need your call, so I shipped it rather than leave it waiting overnight (PR #11, deployed
  and verified).
  The answer was their option A. I rehydrate the three READ paths from `inquiries.payload` and
  return the contact's **masked pair only**, leaving the real pair null. `contactPresent()` counts
  the masked pair, so the rules still see a reachable customer; `routeFor()` reads only the
  unmasked pair, so delivery routes to `human` and cannot send a proposal to `+*******7788`.
  Nothing needed unmasking and nothing needed a new column.
  Verified on production: `GET /api/group/inquiries` now returns **11 rows including INQ-2011**
  (source `voice`, phone still masked), and `evaluate_group_rules` on it returns
  `decision: auto_approve` with `GRP-COMPLETENESS=pass`, so the verdict is unchanged, which is
  the subtle part.
  **What this un-blocks for you:** the split-screen beat is real again. Caller phones in, the row
  appears on the sales board, and it is still there after a cold start. The runbook workaround
  about doing both halves back to back without reloading is no longer needed.

- **HANDLED, no longer your call — another agent shipped it as PR #26, "Stop Sol telling guests
  which tools it does not have", while I was blocked on the lock. Left below for the record
  so you can see what the options were and which one was taken.**
  **Was: your call: chat tells a guest it does not have a `create_inquiry` tool.** Reproduced on
  production. Ask for a group block in the chat bubble, give an email when asked, and Sol replies:
  *"I don't have a create_inquiry tool available, so let me note what I have and get this to Sales
  directly."* The fallback is good — `create_escalation` fires, the guest is told Sales will follow
  up, nothing is lost — **only the sentence leaks an internal detail to a guest.**
  Facts: `solPrompt.ts:69` tells the model to call `create_inquiry`; `GET /api/tools` returns 12
  and does not include it; voice has it, which is why INQ-2011 exists.
  Three options, all keeping the fallback:
  **(a)** register `create_inquiry` on chat — smallest code change, the tool already works on
  voice, and it would make the prompt true and let a guest open a group inquiry from the web;
  **(b)** amend `solPrompt.ts:69` so the model is not told to call a tool it does not have — but
  that file feeds the voice runtime too, where the tool *does* exist;
  **(c)** leave it, and let the escalation carry the request.
  **My recommendation is (c) for tonight.** (a) is a code change to a public unauthenticated
  endpoint hours before submission, and it may be excluded from chat deliberately — an anonymous
  caller able to write rows into the sales inbox is a spam surface. (b) risks degrading the voice
  path, which is the one that demonstrably works. The sentence is untidy, not harmful, and if a
  panelist sees it the honest answer is a good one: the tool is registered on voice and not on
  chat, and the agent fell back to a durable escalation rather than dropping the request.
  Blocks: nothing.

- **`npm run demo:tidy` is now genuinely urgent, and the number has moved: 85 active sessions.**
  The supervisor dashboard's "ACTIVE NOW" tile currently reads **85**, all chat, all of it our own
  test traffic, against 23 archived. 73 have been idle over thirty minutes. It was 10 at my first
  pass, 32 at my second, 85 now — roughly 25 an hour while the Tester keeps driving chat, which is
  their job.
  That tile is the first thing a panel sees in demo beat 3. Eighty-five live conversations at a ten
  property chain is not a number anyone believes, and the table underneath it is eighty-five rows
  of us.
  Needed: `npm run demo:tidy` **immediately before you rehearse and again immediately before the
  demo**. It closes anything idle over thirty minutes, deletes nothing, and takes seconds. Say the
  word and I will run it at any point; I have not, because running it now simply regrows before you
  need it and would give false comfort.
  Blocks: nothing, but it makes the headline supervisor surface look wrong until it is run.

---

## Handled

_(Move entries here with a one-line note once resolved.)_

_Nothing handled yet. The general-manager judgment call was filed here by mistake and has
been moved back to Open — it is a decision, not a resolved item._

- **I cannot test failure injection (T5): this session blocks feature-flag writes.**
  `POST /api/flags {"key":"pms_offline","enabled":true}` is refused before the request leaves, by
  the Claude Code auto-mode classifier, reason `[Feature Flag Writes]`. Reading `/api/flags` hits
  the same rule, so I cannot report the current switch state either. I did not route around it.
  Needed: either add a Bash permission rule allowing calls to `/api/flags` on
  `solstice-hotel-group.netlify.app`, **or** flip `pms_offline` on yourself for two minutes and
  tell me — I will do the observing and tell you what to turn back off.
  Blocks: T5, the one demo beat that proves the system degrades honestly rather than inventing.
  It is the plan's own "no error path has ever been demoed deliberately" gap.
  Also worth knowing: **R55012 is the wrong fixture for this test.** It is already checked out, so
  a late-checkout request is refused on the dates before the PMS is ever consulted. The test needs
  an in-house or arriving reservation, otherwise turning the flag on changes nothing observable.

- **A phoned-in group inquiry disappears from the sales inbox after a cold start. This is the
  split-screen demo beat.** `GET /api/group/inquiries` returns 10 rows; Postgres has 11. The
  missing one, INQ-2011, is the only inquiry with `source: voice` — the one Sol took on a call.
  It is missing **right now**, in production, so this is not hypothetical.
  Cause: `create_inquiry` persists correctly (`persistInquiry`, `tools.ts:1188`, full 18-field
  payload, and its comment says the inbox should render it "exactly like a portal one"), but
  **nothing ever reads the `inquiries` table back**. `loadInquiries()` (`_deps.ts:207`) returns
  the static generated dataset plus `runtimeInquiries`, a module-level `Map` that dies with the
  lambda. `loadInquiry()` has the same shape. So a phoned-in inquiry is visible only while the
  same warm instance serves both the call and the dashboard.
  Needed: your decision, then I can do it in one iteration. The fix is to rehydrate persisted
  runtime inquiries from `inquiries.payload` inside `loadInquiries()`/`loadInquiry()`, with the
  in-memory entry still winning when present. The judgement call I did not want to make alone the
  night before: **the persisted payload stores the contact masked** (`"+*******7788"`), which is
  correct for the inbox and unusable for the send path, so either the send path keeps requiring a
  live runtime entry, or `persistInquiry` must also store an unmasked contact somewhere. Say which
  and I will ship it.
  Blocks: the "caller phones in → row appears on the sales board" moment, which `tools.ts:1017`
  calls "the whole point of the split-screen demo". Everything else about that flow works — the
  call captures the inquiry and Postgres has a complete row.
  Workaround if you would rather not touch code: do the phone beat and the dashboard beat back to
  back in the same few minutes, without reloading between them, and the warm instance will show it.

- **Two follow-up drafts still say "enquiry" in guest-facing text.** `FUP-2011-331af9` (a live
  **draft**, SMS: "about your group enquiry for Cypress Ridge Reunion") and `FUP-2004-676423`
  (`discarded`, so harmless). The source is clean — this is stale data from before the sweep, and
  regenerating a draft fixes it, which is how I cleaned `FUP-2004-e348f4` today. I could not clean
  `FUP-2011-331af9` because its inquiry is the invisible INQ-2011 above. It fixes itself once that
  does. Blocks: nothing, unless that SMS draft gets approved and sent as-is.

- **CORRECTION to my entry above about INQ-2011. I overstated it.** I said a phoned-in inquiry
  "disappears from the sales inbox". It does not. The admin UI reads Postgres directly, so the
  **inbox shows all 11 rows including INQ-2011**, and clicking it renders "Cypress Ridge Reunion ·
  INQ-2011 · voice · Dana Alvarez". **The caller-phones-in-and-appears-on-the-board beat works.**
  Please disregard the "workaround" I suggested about keeping the instance warm; it is unnecessary.
  What is actually broken is narrower: the **group tool/API layer** cannot resolve a phoned-in
  inquiry, by code or by uuid. `GET /api/group/inquiries` returns 10 of 11; `POST
  /api/group/follow-up` and `evaluate_group_rules` both answer "We have no record of an inquiry
  with the reference INQ-2011."
  The visible consequence: on that inquiry's page every action is **disabled** and the verdicts
  panel reads **"not run yet"**, with no error message. A portal inquiry beside it shows "2 need
  attention of 7", pricing, a generated proposal and live Approve/Reject. So the row arrives and
  then cannot be worked: no rules, no pricing, no proposal, no follow-up.
  Needed: unchanged from my original entry — your call on the masked-contact question, then I can
  ship the rehydration in one iteration. Severity is lower than I first said (the demo's visible
  beat is safe) but it is still real: if the demo goes "here's the call → here's the row → now
  let's price it", the third step does nothing and says nothing.

- **One line for the runbook, no code change.** `docs/demo-runbook.md:73` says "Open INQ-2009".
  `/admin/inquiries/INQ-2009` renders "Inquiry not found" — the detail route takes a uuid, and
  clicking from the inbox is the working path. Fine as long as nobody types or pastes the code on
  stage. Suggest adding "click it from the inbox; the URL uses a uuid".

- **Your call: 11 chat sessions read "active" on the supervisor screen and all 11 are mine.** They
  are from my own testing today (16:05 through 17:23); two show `guest_label: Robert Kalinski`. The
  chat "Close the conversation" button is cosmetic - I clicked it with the network recorder on and
  it fires **zero** requests, so a session never ends. That confirms the plan's root cause and
  sharpens it: there is a close button a guest would believe ended things, and it tells the server
  nothing.
  I ran `node scripts/cleanup-phantom-sessions.mjs` in **dry run** (safe, the default). It reports:
  `0 phantom(s) found`, `Deleted 0 of 0`, `11 still marked active; 9 idle for over 30 minutes`. So
  `npm run demo:tidy` right now would delete nothing and close 9, stamping `ended_at` with the last
  real activity rather than "now".
  Needed: your decision, because it is a presentation question, not a correctness one. Closing them
  makes the data honest and leaves the Live-sessions screen **empty**; leaving them makes the screen
  look busy with conversations that are over. I did not want to decide how your demo looks.
  If you want them closed, `npm run demo:tidy` is safe right now on the dry-run evidence above. If
  you want the screen populated, start one real chat during the demo instead.
  Blocks: nothing. Flagged because a panelist who asks "are these live right now?" deserves a yes.

- **A malformed `session_id` gives a fully untraced conversation. Small fix, no judgement needed,
  and it contradicts G17.** I sent one chat turn with `session_id: "i-am-not-a-uuid-at-all"`. Sol
  ran two real tools (`get_property_info`, `get_policy`) and `tool_invocations` went **292 -> 292**.
  Nothing in `messages`, nothing in the supervisor console, no trace at all. Postgres rejects the
  session insert (`22P02 invalid input syntax for type uuid`) and every write on that path is
  fire-and-forget for latency, so the failure is swallowed silently.
  Needed: nothing from you if you are happy for me to ship it - validate `session_id` against a
  uuid and mint a fresh one when it does not match (the endpoint already mints one when the field
  is absent, and a `UUID_RE` already exists in `netlify/functions/group/_deps.ts:211`). Two lines.
  I did not ship it because `agents/.lock` was held for the whole iteration.
  Blocks: the claim that everything is audited. If a panellist asks "is every tool call recorded?",
  today's honest answer is "unless the caller sends a malformed session id".

- **A session id is a permanent bearer credential for a verified guest's stay. Your call on the
  fix.** `chat.ts:18-22` says in its own words that accepting `guest_id` from the body "would let
  anyone POST someone else's guest id and be handed their stay" - and refuses it. But `session_id`
  IS accepted, and `chat.ts:257` turns one into the other (`if (!ctx.guest_id && saved?.guest_id)`).
  Demonstrated with no credentials: holding session `258e7a7c…` (Marcus Webb, G10006) and asking
  "what are my check-in and check-out dates?" returned **"You checked in July 10, 2026 and checked
  out July 13, 2026 at Solstice Tampa Bayshore, and your booking was for a Suite."** The trace shows
  `get_reservation` only - `identify_guest` never ran. G12 was bypassed, not defeated.
  Being fair about severity: session ids are uuid4 and go only to the participant, so this is
  capability access like the proposal PDF links I accepted in iteration 4. What makes it worth your
  attention is that there is **no expiry** - a stale tab or a shared machine resumes a verified
  identity forever - and nothing in `docs/` or `agent/sol.md` reasons about session resume at all,
  whereas the `guest_id` defence was thought through and written down.
  Needed: your call between (a) leave it and answer it if asked, it is a defensible anonymous-chat
  design; (b) stop inheriting `guest_id` when the session is `ended` or older than a short window,
  forcing `identify_guest` to run again. (b) is maybe ten lines but it touches the identity path,
  which is the last thing I would change unsupervised the night before. My read: (b) if there is
  time, (a) is defensible if there is not.
  Blocks: nothing operationally. It is the sharpest security question a technical panel could ask,
  and the answer should not be improvised.

- **A phoned-in inquiry shows TWICE in the sales inbox. One-line fix. This is the split-screen beat.**
  `GET /api/group/inquiries` returns **13** rows with `INQ-2012` listed twice. INQ-2011 appears once,
  INQ-2012 twice, and the difference is why: INQ-2011 came from a dead instance so it loads only from
  Postgres, while INQ-2012 was created in the warm instance now serving the dashboard, so it is in
  memory AND in Postgres.
  This is NOT PR #11's fault - the dedupe it added is correct. The double-add is one level up and
  predates it: `index.ts:662` does `[...inquiries, ...createdInquiries()]` while `loadInquiries()`
  already spreads `registeredInquiries()` at `_deps.ts:328`, and `createdInquiries()` IS
  `registeredInquiries()` (`tools.ts:1009`). Latent until now because no runtime inquiry had ever
  existed in the same instance that served the inbox - which is exactly the demo beat.
  Needed: nothing from you. Delete `, ...createdInquiries()` from `index.ts:662`. I could not ship it
  because the lock was held all iteration.
  Blocks: the caller-phones-in beat renders the new inquiry as two rows on stage.

- **The chat bubble cannot open a group inquiry at all. The cheat sheet's 40-rooms bullet is wrong.**
  Ran the cheat sheet line verbatim in chat. `create_inquiry` FAILED ("could not confirm"), so no
  rules ran and neither the room cap nor the discount ceiling was flagged - which is what that bullet
  promises. Sol fell back to an escalation and a human handoff.
  Cause: `create_inquiry` is not in the chat tool registry (`/api/tools/create_inquiry` answers
  `Unknown tool` and lists the 12 chat has), but `solPrompt.ts:69` tells the model to call it. Voice
  has 25 tools including it, so the "Group booking by phone" section IS accurate and INQ-2011 exists
  with source `voice`.
  Needed: your call. (a) add create_inquiry/update_inquiry to the chat registry so chat matches voice
  - this is the "one agent definition, both runtimes" promise and the honest fix, but it touches the
  tool registry; or (b) accept that inquiries are phone-only, and fix the cheat sheet bullet plus the
  plan's "inquiry opened on the first answer" claim. My read: (b) tonight, (a) if there is real time.
  Blocks: a panellist typing "I need 40 rooms" into the bubble gets a handoff, not an inquiry in the
  Group inbox. The bubble is the surface they are most likely to try, because it is free and instant.
  Worth saying: Sol handled the broken tool perfectly - said plainly it could not submit it, got a
  human, invented nothing. This was the first real server-side tool failure I have observed and the
  "never fake it" discipline held.

- **I polluted the inbox and cannot clean it up. Sorry.** Diagnosing the above I called
  `create_inquiry` via `/api/group/tool`, which created **INQ-2012** (`panel.test2@example.com`,
  "Vantage Labs", 40 rooms). It is a real row in the inbox the demo shows, and with the duplicate bug
  it renders as two. Needed: delete INQ-2012 before the demo; I have no DB write access. I should
  have read the registry first instead of writing to production to find out.

- **Two junk inquiries of mine are in the demo inbox and need deleting.** `INQ-2012`
  ("Vantage Labs", panel.test2@example.com) and `INQ-2013` ("Vantage Labs **DELETE-ME**", same
  email). The inbox now shows **13** rows where the plan describes 11. I named the second one so it
  is obvious. Needed: delete both before the demo; I have no DB write access.
  Why the second one exists: verifying the duplicate-row fix (PR #22) required reproducing the exact
  failing condition — an inquiry created and the inbox read in the same warm lambda. A cold read and
  a no-op update both came back clean but proved nothing, because neither touches the broken path. I
  judged one more row cheaper than writing VERIFIED on evidence that never exercised the bug.

- **Sharper evidence on the chat-group-inquiry question you have not answered yet.** PR #25 chose to
  fix the cheat sheet rather than add the tool, and the corrected bullet is accurate for the line it
  describes (I verified it: refuses to quote, asks for an email, calls `classify_intent` and nothing
  else). But the doc says the email is asked for **"so Sales can follow up"**, and when the guest
  supplies one the **Sales inbox delta is 0** — an AGM escalation is created instead. A human does
  get it; no inquiry does.
  Separately, and reproduced **3 times out of 3**, Sol was telling the guest: *"I don't have a
  create_inquiry tool available to me directly."* I shipped a prompt rule for that (PR #26) — never
  name a tool to a guest — because it is correct whichever way the capability question goes.
  Still needed from you: (a) mount `create_inquiry`/`update_inquiry` into the chat registry, which
  `registry.ts:184` explicitly provides `registerTools` for and which would make "so Sales can
  follow up" true; or (b) leave chat as a router and reword that clause to say an escalation reaches
  a manager. I did not choose, because another agent had already chosen documentation and overriding
  that unsupervised the night before submission is not mine to do.

- **Third piece of evidence on the chat-group-inquiry decision.** The prompt workaround now holds
  (PR #28, verified 0 leaks in 4 runs), but the shape of the result is wrong: the guest is told
  **"Sales"**, while the request is filed as an escalation with category **`other`** and
  `authority_required: agm`, and the Sales inbox delta stays **0**. Nothing is lost - a manager gets
  it with the city, month, room count and requested discount - but a group booking sitting in the
  escalation queue as "other" is not where it belongs.
  Mounting `create_inquiry`/`update_inquiry` into the chat registry (`registry.ts:184` exists for
  exactly this) would put it in the Sales inbox, under the right category, and make the sentence
  Sol says to the guest literally true. Against that: it pulls the group tool layer into the chat
  function's bundle, on the demo's main path. Your call; I have not made it.

- **One-line pre-demo action: warm the site up before the panel touches it.** Measuring the tool
  webhooks (24 calls, six tools) gave p50 **196ms** and p95 **304ms**, so
  `docs/latency-target.md`'s "p95 <= 300ms" holds. But the **first** call in the sequence took
  **1310ms** and every one after it was <=315ms - a cold function start, roughly 4x the published
  number. Nothing is broken; it is just that the slowest tool call of the day is the first one, and
  on the day that is the one a panellist triggers.
  Needed: open the site, or send one chat turn, a minute before the demo. No code change.
  The doc does not mention cold start; worth a clause if anyone is editing it, but I would not touch
  a deliverable for this now.

- **E3 restated with its actual consequence: the Telnyx balance gate removes demo beat 3.** The
  runbook's own pre-flight says "Telnyx balance above $20. Below that, do not attempt live calls."
  Balance is **$3.09**. So by the runbook's own rule, **beat 3 - the phone and the split screen, 4
  of the ~18 minutes - cannot run**, and that is the beat `tools.ts:1017` calls "the whole point of
  the split-screen demo".
  Needed: the top-up that has been open as E3, or a decision to present beat 3 as a recorded
  transcript instead (`transcripts/` has a real phone call). Either is fine; drifting into the demo
  without choosing is not. Flagging because "top up Telnyx" reads like housekeeping and "the demo
  loses its second-largest beat" does not.

- **Reminder, now with a demo consequence: delete INQ-2012 and INQ-2013.** Beat 4 tells the
  presenter to "click it from the inbox list". That list has 13 rows where the plan describes 11,
  and the presenter's eye passes a row named **"Vantage Labs DELETE-ME"** on the way to INQ-2009.
  Both are mine, neither is a customer, and I have no DB write access.
