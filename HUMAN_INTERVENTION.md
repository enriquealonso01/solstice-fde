# Human intervention needed

Anything an agent cannot do without Enrique. Newest at the top. Each entry says what is blocked,
what exactly is needed, and what it is blocking, so a decision takes seconds rather than
archaeology.

Agents APPEND here. Enrique clears entries once handled.

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

---

## Handled

_(Move entries here with a one-line note once resolved.)_

_Nothing handled yet. The general-manager judgment call was filed here by mistake and has
been moved back to Open — it is a decision, not a resolved item._
