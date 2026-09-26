> ## Correction, 2026-09-26 -- the timeline math ran against the wrong deadline
>
> *Prepended at implementer iteration 127; **nothing below is edited**.*
>
> **"Only ONE business day sits between them" is wrong.** The brief says *"You'll have 5 business
> days from receipt to submit."* Received Thu 2026-09-24, the deadline is **~Thu 2026-10-01**, and
> **five** business days sit between: 09-25, 09-28, 09-29, 09-30, 10-01. Run this section's own
> table against that window -- standard 10DLC at its optimistic end is 1 business day of brand
> vetting plus at most 3 of carrier review, so 4 business days, which fits. *"SMS cannot clear
> before submission. That is settled, not a risk to manage"* did not follow from these numbers.
>
> **It made no difference, for an unrelated reason.** No 10DLC brand or campaign was ever
> registered on the funded account -- `plans/01-build-plan.md` D18 and `HUMAN_INTERVENTION.md:122`
> both say so. The clock this section prices never started, so the conclusion happened to hold:
> email is the working default at submission. Everything from "Design consequence" onward is
> accurate and was built, and that is why this cost a paragraph rather than a rewrite.

# Messaging: SMS reality + email (RESOLVED)

Research verified 2026-09-24.

## SMS is blocked by carrier registration, not by us

- Unregistered 10DLC traffic has been BLOCKED OUTRIGHT since 2025-02-03
- Unverified toll-free has been blocked since 2024-01-31
- No trial, demo, pilot, or low-volume exemption exists on any path
- Trial accounts are NOT a workaround; carrier blocking sits upstream of Telnyx

### Timeline math against our dates

Today is Thu 2026-09-24. Submission is ~Sun 2026-09-27. Only ONE business day (Fri 09-25) sits
between them.

| Path | Realistic clearance |
|---|---|
| Standard 10DLC | brand vetting 1-7 business days + carrier review <= 3 business days |
| Sole proprietor | 3-7 business days AFTER carrier review |
| Toll-free verification | ~5 business days, no documented expedite |

SMS cannot clear before submission. That is settled, not a risk to manage.

### The reframe that saves the demo beat

The panel is scheduled AFTER Katie receives the submission, so the live demo happens days later
than the artifact. Standard 10DLC started 2026-09-24 plausibly clears 09-25 to 09-30, which lands
before a panel in that window.

STRATEGY: build the SMS path fully, submit with email as the working default, switch the
phone-only inquiry to real SMS if registration clears before the panel.

### Design consequence: delivery is a channel adapter

send_proposal(proposal_id) picks a channel from the contact data it has:
- email present -> Email
- phone only -> SMS, falling back to Email with the recipient number shown in the UI
- neither -> flag for human

Swapping channels is a config change, never a code change. That is also the honest answer when the
panel asks what happens when a provider fails.

### PDF over MMS: do not

Telnyx developer docs list PDF as "limited carrier support"; the support FAQ omits PDF entirely.
Safe cross-carrier ceiling is 600 KB. Send an https link to the hosted PDF instead.

## Email — Telnyx Email API, GA since 2026-08-05

Recommendation: use Telnyx Email rather than adding Resend.

- Same API key, same bill, same dashboard as voice and messaging
- Shared domain gives a working send in about two minutes; custom domain available with automated
  DKIM/SPF/DMARC record generation
- Endpoints: /email_messages, /email_templates, /email_events for delivery tracking
- Pricing from $0.30 per 1,000

Architecture payoff: ONE communications provider across voice, SMS, and email. The backend map
gets far easier to narrate, and there is one fewer vendor for a nervous IT team to approve.
Resend stays documented as a drop-in fallback behind the same adapter.
