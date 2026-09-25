# Demo runbook

The order to show things in, what to say, and what to do when something breaks. Written for two
audiences in one room: a director of engineering and a non-technical product owner.

**Total: about 18 minutes of demo, leaving the rest for their questions.** Do not fill the hour.

---

## Before they join

- [ ] Two windows side by side: guest site left, admin right. Both signed in already.
- [ ] Signed in as `admin@solsticehotels.com` (sees everything, including Backend and Cost).
- [ ] Phone in hand, on the desk, ringer up.
- [ ] Telnyx balance above $20. Below that, do not attempt live calls.
- [ ] Failure injection panel showing **all healthy**. Check this; a switch left on from rehearsal
      makes a working system look broken.
- [ ] `npm run demo:tidy` — **run this last, minutes before they join, not the night before.**
      Every chat you open leaves a session marked `active`, because a browser tab has no hangup
      event to close it. So rehearsing is itself what fills the supervisor dashboard with stale
      "live" conversations, and tidying early simply gets undone by your own last rehearsal. Run
      it with no flag first to see the count, then `npm run demo:tidy` to close them.
- [ ] `docs/demo-cheatsheet.md` open in a tab you can glance at for confirmation numbers.
- [ ] Close every other tab. Especially this repository.

---

## The arc

The story is one sentence: **the front desk is drowning in repetitive questions and group quotes
take two days, so we built an agent that handles the routine and hands humans the rest with
everything they need.** Everything below serves that sentence.

### 1. The problem, in their words (1 min, no screen)

Do not open with architecture. Open with their brief: 140 properties, a front desk buried in
repetitive requests, and group quotes taking two days that should take twenty minutes. Say that
what you built handles both, and that you are going to show the guest side first because that is
where the value is.

### 2. Guest chat (3 min)

Open the landing page. Click the bubble.

- **"What time is checkout?"** — answers immediately, cites Policy 1.
- **"Can I bring my dog?"** — no pets, service animals always, and it may not ask for papers.
  Say out loud: *that ADA nuance is in their policy document, and a general-purpose chatbot gets
  it wrong.*
- **"How much is parking at the Chicago Riverwalk?"** — **it refuses to quote a number.** This is
  the single most important moment in the demo. Policy 12 says there is no chain-wide parking
  rate, so the agent says it does not have one instead of inventing a plausible figure.

Point at the tool chips as they appear. *Every answer names the tool it used and the policy it
read. Nothing here is the model remembering something._

### 3. The phone, and the split screen (4 min)

Put the admin window on the supervisor dashboard first, so they see it empty.

Call **+1 (305) 786-6217** on speaker. Say your confirmation number is **R55004, last name Chen**.
Ask to keep the room until 2pm.

- The session appears on the dashboard **while you are still talking**.
- The transcript streams in.
- Sol grants 2pm as *guaranteed*, because Platinum is the one tier the policy guarantees.

Say: *same agent, same tools, same rules. The phone is a different door into one system, not a
second product.*

While still on the call, open the session and click **Listen**. You hear the guest through the
browser. Say plainly: *I can monitor a live call from here, and if I click Take over, Sol stops
talking and the call stays up. Sol's own audio does not reach this leg, which is an undocumented
corner of supervising an assistant call, so the transcript is what carries its half.* Volunteering
that is stronger than being caught by it.

### 4. Group booking (4 min)

Switch to Group sales. Open **INQ-2009**, the Phoenix retreat. **Click it from the inbox list.**
The detail URL takes the row's uuid, not the code, so typing `/admin/inquiries/INQ-2009` renders
"Inquiry not found" — a dead end you do not want to discover on stage.

- One flag: they asked 17%, the property's ceiling is 15%.
- Three costed options: approve at 15% for $7,994.25, escalate for a sign-off at 17%, or counter
  at 16% with a value-add tied to their yoga request.
- If asked who signs off: approval authority is a named human, not a role tier. The system
  enforces that an approval happened and is attributable in the audit log; a GM tier is a
  one-value enum addition in phase two. Stated as assumption 3 in the README.
- **The send button is locked**, with the reason printed next to it.

Then open **INQ-2007**, Providence. Two things their own sample data contains and most candidates
will miss:
- A suite rate of **−395**, quarantined rather than priced against.
- A referral to a "Boston-area sister property" that **does not exist** in the directory, so the
  agent passes the referral on and states plainly it cannot quote there.

Say: *these are in the data you sent us. We did not add them.*

### 5. Failure injection (2 min) — the moment they will remember

*Rehearsed end to end on production. Every line below is what actually came back.*

**First, while everything is healthy**, ask in the guest chat:

> *"Hi, this is Michael Chen, confirmation R55004. Can I keep the room until 2pm today?"*

> **Yes — as a Platinum member, 2pm checkout is guaranteed on R55004, no need to worry about it.**

Identify in the same sentence. If you just ask for a late checkout, Sol correctly asks who you
are first, and you spend the beat on identification instead of the outage. Use **R55004**, the
same number as the phone beat, so you are not juggling two. Use Platinum: Gold is conditional on
availability by policy, so a Gold guest gets a hedged answer even on a healthy system and the
contrast disappears.

**Now** go to the Backend page, Failure injection, and take the **property management system**
offline. Give it a few seconds. Ask the identical question again:

> **I'm not able to confirm same-day availability right now — our system is down. I can't promise
> 2pm at the moment, but as a Platinum member it's likely we can accommodate it once I can check;
> I'll have a colleague follow up with you shortly to confirm.**

A guaranteed yes became an honest "I cannot check". Point out that **it still called the tools** —
`identify_guest` and `check_late_checkout` both fire. The refusal comes from the dependency, not
from the model deciding to be careful, which is the difference between a guardrail and a mood.

**Then, in the same conversation**, ask a policy question:

> *"And separately, what is your cancellation policy for a flexible rate?"*

> **Free cancellation up to 72 hours before check-in. Cancelling inside that window forfeits one
> night's room and tax to the card on file.**

Say: *the outage is scoped. In production the PMS goes down and the policy reference does not, so
the agent loses exactly the answers that depend on the thing that broke, and no others.*

**Bring it back online and confirm all three switches read healthy before you move on.** A switch
left on makes the rest of the demo look broken.

### 6. Cost, for the product owner (2 min)

Admin, Cost. Two numbers:
- **Cost per conversation**, measured, not modelled.
- **The monthly projection at 140 properties**, with inputs they can argue with.

Point out that **telephony is the majority of the bill, not the AI**. It reframes the whole
conversation and it is the opposite of what most people assume.

### 7. Architecture, for the engineer (2 min)

Backend map. Do not narrate all seven tabs. Show the whole-system view, then one tab.

The line that matters: **business logic lives in typed tools, not in the prompt.** Discount
ceilings, comp authority and cancellation windows are code with tests. The model decides what to
say and which tool to call; it never decides what the policy is.

---

## When they ask you to change something live

They will. Have this one ready:

> "Change Phoenix's discount ceiling from 15% to 12%."

1. Open `src/lib/rules/thresholds.ts`.
2. One line: `SOL-PHX` max discount 15 to 12.
3. Re-run INQ-2009. The verdict, the sentence a rep reads, and all three costed options move
   together.

Say while doing it: *the reason this is one line is that no threshold lives in a prompt. If it did,
this change would be a prompt edit with no test and no audit trail.*

---

## If something breaks

| What breaks | What to do |
|---|---|
| The phone call fails | Use the mic in the chat bubble. Same agent, same tools. Say so and move on. |
| The site is slow to answer | Point at the tool chips: *it is working, and it is showing you what it is doing.* Do not apologise twice. |
| A screen errors | The error boundary shows the real message. Read it aloud, say what you would check, move on. Handling it calmly is worth more than not hitting it. |
| Supervisor audio sounds one-sided | Expected, and say so before they notice: the supervisor leg carries the guest but not Sol's synthesized voice. Point at the live transcript, which has both sides, and explain the conference-based fix you chose not to build days before submission. |
| Something is genuinely wrong | Say "that is a bug, here is what I would look at" and keep going. They are evaluating how you handle it. |

---

## Things to say once, and not repeat

- **On honesty:** "SMS is built but not live, because US carrier registration takes days and I
  started it late. The delivery layer picks the channel from config, so it is a switch, not a
  rewrite."
- **On the agents that built this:** six agents with file-ownership boundaries built most of this
  in a day, and the most valuable thing they produced was the bugs they found in each other's
  work. `docs/how-this-was-built.md` if they want it.
- **On what is not real:** the availability service is simulated, and every result says so. There
  is no inventory-by-date in the data they sent, and inventing one silently would have been the
  wrong answer to a question the brief explicitly asks about.
- **If they ask where a phoned-in group request goes:** straight onto the sales board, as a row
  sales can price and decide on exactly like a portal request. `INQ-2011`, Cypress Ridge Reunion,
  is a real one Sol took on a call — open it. The row is persisted and merged into the inbox
  additively, so it survives a restart, and the contact stays **masked**: the rules can see we
  have a way to reach the customer, and delivery finds no address and routes to a human. Say it
  as the deliberate choice it is — *a phoned-in inquiry can be priced and judged, and cannot be
  silently emailed to a row of asterisks.*

---

## Do not

- Do not open the repository unless asked. It reads as hiding behind code.
- Do not demo more than one thing at a time on screen.
- Do not claim the supervisor hears both sides. It hears the guest; the transcript carries Sol.
- Do not fill silence after a question. Answer it, then stop.
