# Solstice FDE Challenge — Requirements (source of truth)

Captured from Enrique 2026-09-24. Supersedes all earlier plans (see plans/archive/).
Deliverable deadline: ~72h from 2026-09-24 receipt, submit to kdesotell@phdata.io.

## One app, two faces, split-screen demo

The demo is a split screen: guest side on one half, admin side on the other. Messages and calls
on the left show up live on the right.

---

## A. GUEST SIDE (public)

- **Hotel landing page.** White-label-ish, generic-but-real hotel feel. The landing page is NOT
  the product; it is the stage.
- **Chat bubble, bottom-right.** THIS is the deliverable. UI must be pristine. Opens a chat with
  the agent. This plus the phone number is everything the guest sees.
- **Phone number displayed** for guest support. Guests can call it during the demo.
- **Same persona on both channels.** Named AI assistant, same voice and manner on phone and chat.
  Chat should feel faster and more agentic.
- Greeting pattern: "Hi, I'm <NAME>, I'm here to help with anything you need."
- The agent must never go rogue, and everything it does must be observable.

---

## B. ADMIN SIDE (same app, three logins)

### Login 1 — Concierge Supervisor (scoped)
Sees conversations only. Cannot see group sales.
- Live dashboard of active sessions: who is calling/chatting, right now.
- Click a session, watch the live transcript stream as it happens.
- See what the agent is doing and where it is taking the guest.
- **Interrupt the agent and take over the call.**
- Full archive of past chats and calls.

### Login 2 — Group Sales (scoped)
Sees group inquiries only. Cannot see concierge conversations.
- All inbound group inquiries listed; each opens as its own project view.
- Auto-handled inquiries (complete + within rules + email present): one button, "Accept and send".
- Proposal artifact: branded HTML email + PDF attachment.
- If inquiry arrived by phone and has only a number: send proposal by SMS instead.
- **Side chat with an assistant on any inquiry**: modify it, ask questions, send it, delete it.

### Login 3 — Super Admin (everything)
- Full access to both dashboards.
- Invite members by email, grant roles: concierge, group sales, admin.
- **"Backend" page**: interactive system map for presenting to a technical audience.
  - One tab per subsystem, plus a zoom-out view of the whole system.
  - Shows providers and real names: where the site is deployed, where the voice agent lives,
    where the database is, every service used.
  - Enrique narrates over it live. It must support "why I chose X over Y".

---

## C. DEMO SCRIPT: three group inquiries

1. **Auto-approvable, email present.** Within all standards. One click sends a drafted branded
   thank-you email + PDF proposal to Enrique's email.
2. **Phone-only, no email.** Arrived via the voice agent, so only a phone number exists.
   On approval, sends the PDF proposal + short message to Enrique's phone by SMS.
3. **Needs a human decision.** Sales rep must make a judgment call. Agent surfaces options and
   tradeoffs; rep decides; agent regenerates.

---

## D. Brief deliverables still owed

- Architecture diagram (.drawio or Lucid) of the future-state production system
- Short integration recommendation (PMS, central reservations, loyalty/CRM) + the honest
  "is the AI coming for our jobs" answer
- Agent configuration .md: system prompts, tool/skill definitions, guardrails, sample transcripts
- At least one net-new tool the sample data did not hand us
- Native export from the platform (Telnyx assistant JSON)
- Be able to open the hood and change something live during the panel

---

## E. Hard constraints

- Everything embedded in ONE deployed application
- Deployed to Netlify
- Enrique owns big decisions; Claude owns small ones
- Must be fully explainable and modifiable live by Enrique
