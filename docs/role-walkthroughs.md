# Three roles, click by click

Solstice has three staff roles, and each one sees a different product. This walks each of them
end to end: what to click, what appears, and — the part that matters — **what each click proves.**

Written against the live system on 2026-09-25 by signing in as all three accounts and reading
what actually rendered. Every count and label below was observed, not described from the design.

Credentials are in `DEMO_LOGINS.md` locally and in the submission email body. All three share one
password. Sign in at **`/login`**.

> **The one idea worth holding on to.** The navigation is filtered by role, but that filtering is
> cosmetic. The real boundary is row level security in Postgres. The UI hides the door; the
> database is what locks it. You can prove that in ten seconds — see *Proving the boundary* at the
> end — and it is worth doing, because a demo that only shows a hidden menu item has shown you
> nothing.

---

## 1. Concierge supervisor — `supervisor@solsticehotels.com`

**Who this is.** The person responsible for guests who are talking to Sol right now. They care
about one thing: is any conversation going wrong, and can I get into it in time.

**Sign in.** You land on `/admin/sessions`. Look at the top navigation first: it contains exactly
one item, **Live sessions**. No Group inbox, no Cost, no Backend map. That is the whole point of
the role, visible before you have clicked anything.

### Step 1 — read the four tiles across the top

| Tile | What it reads | What it means |
|---|---|---|
| **Active now** | a count, plus `N voice · N chat` | conversations in flight this second |
| **Human in control** | a count, `Supervisor took the call` | how many a person has already stepped into |
| **Archived** | a count, `Full transcript retained` | finished, still fully readable |
| **Realtime** | `Connected`, `conversations, messages and actions, live` | the live channel is genuinely subscribed |

**What this proves:** the page is not polling on a timer. That last tile names the three streams it
is subscribed to — conversations, messages and the actions the agent takes — through Supabase
Realtime. Leave the page open while someone calls the number and a row appears without a refresh;
that is the demonstration, and it is better than any label.

*(It used to print the Postgres table names. Correct evidence, wrong audience: a concierge
supervisor does not read `tool_invocations`.)*

Under the tiles sits a banner: **Supervisor audio ready — this browser is registered as a SIP
client, so a call you take over will reach your headset.** Worth reading aloud. It is the
difference between a dashboard that shows you a call and one that can put you inside it.

### Step 2 — filter by channel

Three buttons: **All channels**, **Voice**, **Chat**. Click **Voice**. The table narrows to
telephone conversations.

**What this proves:** voice and chat are the same conversation object in the same table, not two
systems bolted together. The filter is over one list.

### Step 3 — read one row before opening it

Columns: **Guest · Channel · Intent · Started · Length**, then **Open**.

Look at the Guest column on a phone call. It reads like `Unknown caller +*******2646`. **The
phone number is masked in the database layer, not blurred in CSS.** A supervisor who does not
need the digits does not get the digits.

The Intent column is filled by `classify_intent`, the routing decision Sol makes before anything
else — that is Sol deciding what the conversation is about while it is happening. A row that still
reads `classifying…` is one where no classification has been recorded yet, which on a live call you
may briefly catch.

### Step 4 — open a session

Click **Open**. Three panels:

- **Transcript** — the conversation, turn by turn. On voice, turns arrive one at a time as the
  call proceeds.
- **Tool trace** — every tool the agent ran, *with its arguments masked*. This is the panel to
  linger on. It is the audit answer to "what did the AI actually do", and it shows the masking is
  applied on the way into the log, not on the way out to the screen.
- **Session facts** — channel, timing, identity as far as it has been established.

**What this proves:** nothing about the agent's behaviour is unrecoverable after the fact. You
can reconstruct any conversation and every action it took.

### Step 5 — the supervisor ladder

On a live voice session, four rungs, in increasing order of intervention:

| Rung | Effect, as the UI states it |
|---|---|
| **Listen** | you hear the call; nobody hears you |
| **Whisper** | only Sol hears you. The guest does not |
| **Barge** | everyone on the call hears you. Sol keeps going |
| **Take over** | Sol stops talking. The call stays live and is yours |

A chip next to the ladder reports the audio leg honestly at every stage: `audio ready`,
`connecting audio`, `audio live`, and on the failure side `not permitted`, `audio unavailable`,
`browser unsupported`, `audio failed`.

**What this proves:** escalation is a gradient, not a switch. The common real-world case is
whisper — the supervisor corrects Sol without the guest ever learning a human was watching.

> **Say this plainly in the demo.** The ladder is built and the browser registers as a SIP client,
> but it has never been exercised end to end on a live call. It is the one headline capability
> standing on code review rather than on a recording. Claiming otherwise is the sort of thing a
> panel catches.

### Step 6 — intervene in a chat, which is a different control

Open a **chat** session instead of a call. Where the ladder was, there is an **Intervene** panel:
**Join this chat**, a message box, **Attach a file**, **Send to guest**, and once you are in,
**Hand back to Sol**.

The ladder is not shown here, and that is the point worth making out loud. Listen, whisper and barge
are all operations on live audio. A text conversation has none, so three of those four rungs would be
buttons that cannot do anything, and one control that works beats four that look impressive.

**Do this in the demo, on the split screen.** Open the guest bubble on one side and this panel on the
other. Type into the panel and press **Send to guest**. Three things happen at once:

1. A gold-railed bubble labelled **Solstice team** appears in the guest's chat, visibly not one of
   Sol's. A guest must always be able to tell which sentences came from an AI.
2. A banner appears above the guest's transcript: *A Solstice team member has joined.*
3. The session's status chip flips to `taken over`, on both screens.

Then ask the guest side another question. **Sol does not answer it.** Not "answers more carefully" —
does not answer. The guest's message is still recorded, because you need to read it, but no model is
called at all.

**What this proves, and it is the most important sentence on this page.** *Take over* is not a label
on a button. Joining writes `taken_over` to the session row, and the chat runtime checks that row
before it calls the model. Delete the Intervene panel entirely and the guarantee still holds for
anything else that sets the status. The UI is the affordance; the database is the mechanism. That
distinction is the whole architecture of this system in one control, and it is the same reason the
role scoping lives in row level security rather than in a hidden menu item.

Press **Attach a file** and send a PDF. It arrives in the guest's chat as a download card with the
file's name and size, and the same file appears in the transcript on this side, so the archive records
*what* was sent rather than merely that something was. Files go one way only, staff to guest, and
nothing is virus-scanned: an upload path in both directions with no scanning is a malware relay with a
hotel's logo on it. `docs/where-this-goes.md` carries both as work, not as a claim.

---

## 2. Group sales — `sales@solsticehotels.com`

**Who this is.** The person who turns a group enquiry into a priced proposal, and who is
accountable when a discount goes out that should not have.

**Sign in.** You land on `/admin/inquiries`. The navigation again holds exactly one item: **Group
inbox**. This account cannot reach live guest conversations at all.

### Step 1 — the four tiles

**Open inquiries · Needs a decision · Ready to send · Awaiting the guest** (the last hinted
`Clarifying questions out`).

Read them in that order and the workflow explains itself: everything in, the ones a human must
judge, the ones cleared to go, and the ones where Sol is still waiting on the customer.

### Step 2 — the filters

**All · Needs a decision · Ready to send · Sent.** Click **Needs a decision**. What remains is
precisely the queue this person is paid to work.

### Step 3 — read the table

Columns: **Inquiry · Property · Dates · Rooms · Discount · Total · Rules · Proposal**.

Two things to point at:

1. **The Discount column sometimes shows two numbers**, e.g. `22% 15%`. That is what the customer
   asked for next to what the rules allow. The gap is the decision.
2. **The Rules column says what this row is waiting for.** `ready to price` means every field is
   there and nobody has quoted it yet; `3 missing` means Sol is still chasing the customer for
   three answers. Once a proposal exists it becomes the rule verdict instead. The Proposal column tracks
   its state independently — `none yet`, `rejected`, and so on.

The Inquiry column also carries the source: `voice` or `portal`. **The same inbox holds enquiries
that arrived on a phone call with Sol and ones typed into the website.** One pipeline, two front
doors.

### Step 4 — open an inquiry that needs a decision

Click **Open** on one flagged `Needs decision`. The page is organised as a single argument:

- **Decision** — the actions, and above them the reason they are or are not available
- **Parsed requirements** — Property, Event, Arrival, Departure, Nights, Rooms, Room type,
  Discount asked, Budget / night, Meeting space, Alternate property, Contact
- **Rule verdicts** — each rule, passed or failed
- **Pricing** — the derived numbers
- **Generated proposal** — the document itself

**What this proves:** Sol extracted structured fields from prose. The Parsed requirements panel is
the intermediate representation, shown rather than hidden, so a human can check the reading before
trusting the verdict.

### Step 5 — the approval gate, which is the thing to actually demo

On a flagged proposal the Decision panel shows an amber **Locked** banner with a specific
operational reason. Not "validation failed" — something closer to:

> "The customer asked for 17% off. We can approve up to 15% on our own, so this is 2 points over
> what we can authorise ourselves, and it needs a named approver to sign it off before it goes
> out."

**If a panel asks who that approver is, the honest answer is a stated assumption, not a gap.**
Approval authority is a named human rather than a role tier: the system enforces that an approval
happened and is attributable in the audit log, and deliberately does not model a GM login. It is
assumption 3 in the README and assumption 13 in `agent/sol.md`.

The buttons are:

| Button | What it does |
|---|---|
| **Accept and send** | disabled while the proposal is locked |
| **Submit for approval** | routes it to someone with the authority |
| **Approve** | approve **at the compliant rate** |
| **Override to N%** | grant what was actually asked, and own it |
| **Reject** | decline |

Approve, Override and Reject **all require a typed justification**. There is no silent approval.

The header of the panel states delivery up front: `Delivery: branded email + PDF`, or `SMS with a
link to the PDF`.

Below the buttons, a decision log builds up, each entry ending in **`· written to the audit trail`**.

**What this proves, and it is the strongest claim in the product:** the gate is not the button
being greyed out. The same refusal has been attacked from four directions in testing — the send
endpoint with a valid staff token, the proposal-action endpoint, the agent's own `send_proposal`
tool called with the **real** webhook secret, and by social-engineering the assistant with a
claimed verbal approval from the GM. All four refused, and each refusal wrote an audit row naming
the blocking rule and who asked. Greying out a button is UI. Refusing your own agent holding a
valid credential is a guardrail.

### Step 6 — edit the proposal, and watch what you cannot edit

Open the generated proposal and change the prose. Then try to change a number.

**What this proves:** prose is editable, figures are not. The server accepts exactly three fields
— the opening paragraph, the next-steps paragraph, and the "good to know" notes — and nothing
else. Every number stays derived from the rules engine. A salesperson can make it sound right;
they cannot make it *say* a price the engine did not produce. If the discount itself has to
change, that is the Override path, and Override is audited.

---

## 3. Super admin — `admin@solsticehotels.com`

**Who this is.** The owner. Sees both scoped roles' work, plus the machinery and the bill.

**Sign in.** You land on `/admin`, greeted by name. The navigation now holds **five** items:
**Overview · Live sessions · Group inbox · Backend map · Cost**.

**Do this deliberately in the demo:** sign out of `sales@`, sign in as `admin@`, and let the panel
watch the navigation grow from one item to five. That single moment communicates role scoping
better than any explanation.

### Step 1 — Overview

Subtitle: *Everything both scoped roles see, plus who is allowed to see it.*

Four tiles: **Live sessions** (`voice and chat, right now`), **Needs a decision**
(`group inquiries`), **Sent this cycle** (`proposals delivered`), **Staff accounts**
(`each one sees only its own work` — note the wording: it describes what a person sees, not where the
rule lives, and the rule is still in the database).

Then two panels side by side, **Concierge · live now** and **Group sales · needs a decision**,
each linking straight into the scoped role's own screen. Below them, **Recent decisions**.

At the bottom, **Members and access**: Member, Role, Added, and a **Send invite** button.

**What this proves:** the admin view is composed from the same data the scoped roles read, not a
separate reporting copy.

### Step 2 — Backend map

Seven tabs: **Whole system · Guest channel · Voice · Agent and tools · Data · Delivery · Deploy.**

Real provider names on real boxes, with narration notes. Walk **Voice** when asked "what actually
happens when someone calls", and **Agent and tools** when asked "where does the model sit".

**What this proves:** the architecture diagram is not a drawing made afterwards. It is a view of
the system, in the product, that an owner can open mid-conversation.

### Step 3 — Cost

This is the page to finish on with a commercially-minded audience.

Three figures at the top:

- **Spent so far** — *"Measured from real usage since 2026-09-24"*, across the real conversation
  count. Mostly telephony.
- **Per conversation** — *"This is the number that scales. Everything else is roughly fixed."*
- **Telnyx balance** — *"Live from the Telnyx API, not an estimate."*

Then **What it would cost Solstice**, with two inputs you can change while talking: **properties**
and **guest conversations per property per day**. Set properties to 140 and let the number move.

Below that, **Language model usage** as a real table: Model, Turns, Input, Output, Cached read,
Cache hit, Cost. The cache hit rate is worth pointing at — it is most of why the per-conversation
number is as low as it is.

Finally **Traffic behind these numbers** and a collapsible **Rate card** stamped with the date the
rates were checked.

**What this proves:** every figure is measured, and the page says where each one came from. The
Telnyx balance is read live from their API during the demo, which is the least fakeable number on
the site.

---

## Proving the boundary, in ten seconds

The nav filtering is cosmetic. Prove the real thing:

1. Sign in as **`sales@`**.
2. Type `/admin/cost` straight into the address bar, bypassing the hidden menu entirely.
3. **The browser bounces you back to `/admin/inquiries`.** That is the router being tidy, and on its
   own it proves nothing — a redirect is still the UI deciding. Do the mirror version if you like
   (`supervisor@` at `/admin/inquiries` lands back on `/admin/sessions`), but do not stop here.
4. **Now ask the API directly, which is where the boundary actually lives.** Open devtools, copy the
   `access_token` out of the Supabase session in local storage, and:

   ```bash
   curl -i https://solstice-hotel-group.netlify.app/api/group/proposals \
     -H "authorization: Bearer <a concierge token>"
   ```

   ```
   403 Forbidden
   {"ok":false,"error":"This role cannot see group sales. Group sales inquiries are readable by
    group_sales and admin only, which is what row level security enforces in the database as well."}
   ```

   Drop the header entirely and it is **401** — `Authorization: Bearer <supabase access token> is
   required.` Two different refusals, because "who are you" and "you are not allowed" are two
   different questions.

The database enforces the same thing underneath: the same concierge token reading `inquiries`
directly through PostgREST returns **zero rows of thirteen**, and `group_sales` reading `sessions`
returns zero of the concierge's hundred-plus. Neither is a filtered view — the rows are not there
to be had.

**Why this matters more than it looks.** A hidden menu item is a suggestion. A 403 from the
database to an authenticated user holding a real token is a boundary. If a panel member asks "but
is the security real or is it just the UI", this is the answer, and it takes one address bar.

---

## If you only have five minutes

1. `sales@` → an inquiry that needs a decision → **read the Locked banner out loud.** It is
   written in a manager's language, not a validator's.
2. Note that the same refusal holds against the agent's own tool with a valid secret.
3. Sign out, sign in as `admin@`, **watch the navigation go from one item to five.**
4. Open **Cost**, set properties to 140.

That is the product: it knows what it is not allowed to do, it can prove who is allowed to see
what, and it knows what it costs.
