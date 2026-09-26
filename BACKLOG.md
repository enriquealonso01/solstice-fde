# Backlog

Drop ideas here. One per line, however rough. No format required, no ticket numbers, no
estimates. "the chat bubble feels cramped on mobile" is a perfectly good entry.

I read this file at the start of every loop iteration, work items in the order below unless one is
obviously urgent, and move each to **Done** with a note on what actually changed.

If something is urgent or you want it done next, put `!!` at the front of the line.

---

## Inbox — your ideas go here

<!-- add lines below this comment -->

_(empty — all items triaged into `plans/06-master-plan.md`)_

---

## In progress

_(empty — both entries resolved and moved to Done at It129. This section had said "the Implementer
is on it" for hours after the Implementer finished, which is the one thing a file read at the top of
every iteration must not do.)_

---

## Done

_(Newest first, with what changed and anything worth knowing.)_

- **Dashboards should not feel technical** (Enrique, 2026-09-25) → master plan **T29**, **CLOSED
  3 of 3**, PRs #50, #53 and #54. Engineering vocabulary a hotel manager would not use is gone from
  the three user-visible places it appeared, with the substance underneath it left alone.

- **Click-by-click tutorial per admin role, spotlight the relevant area, grey the rest** → **T4a
  SHIPPED** (PR #3, `0de4608`): the three walkthroughs as text in `docs/role-walkthroughs.md`,
  pinned by `walkthrough-quotes.test.ts`. **T4b and T4c — the in-app spotlight overlay — were
  deliberately never started**, on the reasoning written here at the time: they were conditional on
  T1–T3 coming back clean, and building an overlay the night before submission buys less than it
  risks. Recorded as a decision rather than as a loose end.

- **"Talk to Sol" mic on the landing page** — FIXED and live, PR #1 / commit `efe1226`. The hook
  pinned opus by handing `setCodecPreferences` a hand-written descriptor; Chrome only accepts a
  capability object it advertised itself, so it threw, the Telnyx SDK did not guard the call, and
  the guest saw the SDK's generic "An unexpected error occurred". Now forwards the browser's real
  capability. Verified against production in headless Chrome: the call reaches "Listening".
  Worth knowing: **that one 3-second call cost about $0.48.** Do not re-verify voice in a loop.

- **Auto-triage agent** — shipped as `/api/group/triage`: sweeps every inquiry, drafts a follow-up
  when data is missing and a proposal when it is complete, sends nothing, idempotent, audited, and
  refuses the two inquiries inside blackout windows. Confirmed deployed (401 anonymous, not 404).
  **Caveat CLOSED at It129 (PR #166), and it had no test at all** — 52 test files, not one mention.
  `src/lib/rules/__tests__/triage.test.ts` now runs the real sweep twice against the real dataset,
  with no database, and asserts all of the above: 7 proposals and 1 follow-up on the first pass,
  every one of them `skipped_existing` on the second, INQ-2003 and INQ-2010 refused **both times**
  with the blackout window named, and no reachable path from the sweep to a send.

  **Do not run the sweep against production before the demo.** Measured with the service-role key
  at 06:35Z: of the 13 inquiries in the live inbox, INQ-2012 and INQ-2013 are the only ones a run
  would write to, and those are the two queued for deletion — so the sweep would draft follow-ups
  onto rows that are about to disappear. INQ-2003 and INQ-2010 look bare and are not: the sweep
  refuses them, which is why they have no artifact. Nothing needs running to believe any of this.

---

## Rejected or deferred, with the reason

Kept visible on purpose: an idea that was considered and dropped is more useful than one that
silently vanished.

- **Unofficial iMessage relay for blue bubbles** — dropped. No legitimate cheap option exists;
  the workarounds violate Apple's terms and can get the account banned mid-demo. SMS via 10DLC is
  the correct path. Full reasoning in the conversation of 2026-09-24.

- **Chat takeover has no mechanism behind it.** `transfer_to_human` on chat raises a hand that
  nothing catches: `request_supervisor_takeover` has no consumer, there is no supervisor presence
  signal, and the session row is untouched. Iteration 8 made the *wording* honest (PR #7) so no
  guest is told a colleague is joining when none is. The mechanism itself - a `needs_supervisor`
  marker on `sessions` plus a queue in the supervisor console - is the real product fix and was
  deliberately left alone the day before submission. Not blocking anything.
