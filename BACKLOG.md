# Backlog

Drop ideas here. One per line, however rough. No format required, no ticket numbers, no
estimates. "the chat bubble feels cramped on mobile" is a perfectly good entry.

I read this file at the start of every loop iteration, work items in the order below unless one is
obviously urgent, and move each to **Done** with a note on what actually changed.

If something is urgent or you want it done next, put `!!` at the front of the line.

---

## Inbox — your ideas go here

<!-- add lines below this comment -->

_(empty — both items triaged into `plans/06-master-plan.md` on 2026-09-25 12:0x)_

---

## In progress

- **Click-by-click tutorial per admin role, spotlight the relevant area, grey the rest** → master
  plan **T4a / T4b / T4c**. Split deliberately: T4a writes the three walkthroughs as text
  (`docs/role-walkthroughs.md`), T4b builds the in-app spotlight overlay and wires one role, T4c
  does the other two. With submission at 11:00 tomorrow, T4a is the piece that will realistically
  ship; the overlay only happens if T1–T3 come back clean. Flagging that now rather than at 10:00.

---

## Done

_(Newest first, with what changed and anything worth knowing.)_

- **"Talk to Sol" mic on the landing page** — FIXED and live, PR #1 / commit `efe1226`. The hook
  pinned opus by handing `setCodecPreferences` a hand-written descriptor; Chrome only accepts a
  capability object it advertised itself, so it threw, the Telnyx SDK did not guard the call, and
  the guest saw the SDK's generic "An unexpected error occurred". Now forwards the browser's real
  capability. Verified against production in headless Chrome: the call reaches "Listening".
  Worth knowing: **that one 3-second call cost about $0.48.** Do not re-verify voice in a loop.

- **Auto-triage agent** — shipped as `/api/group/triage`: sweeps every inquiry, drafts a follow-up
  when data is missing and a proposal when it is complete, sends nothing, idempotent, audited, and
  refuses the two inquiries inside blackout windows. Confirmed deployed (401 anonymous, not 404).
  Caveat worth knowing: verified by the session that built it, not yet re-checked by the Tester.

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
