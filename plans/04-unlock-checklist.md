> ## Correction, 2026-09-26 -- this checklist is done except for one line
>
> *Prepended at implementer iteration 127; **nothing below is edited**. Every box below is unticked,
> which reads as "none of this has been unblocked". The opposite is true: it was unblocked on
> 2026-09-24 and 09-25 and the project has been building on it ever since.*
>
> **Section 2, credentials -- all set.** The app runs, Sol answers on chat and on the phone,
> proposals generate, and a proposal email has actually been delivered. `.env.example` carries the
> full list and `src/lib/rules/__tests__/setup-env.test.ts` keeps it honest.
>
> **Section 3, account actions -- all done.** Netlify and GitHub are authenticated; every iteration
> branches, opens a PR, merges it, and deploys to production. The Credential SIP Connection exists
> and a supervisor has attached to a live call over it. Telnyx Email is proven end to end.
>
> **Section 4 -- all five done**, which is why it is the one section with no boxes to tick: the
> number **+1 (305) 786-6217** is bought and attached, the assistant is provisioned from
> `agent/sol.md`, the webhook tools and the transcript webhook are registered, the SIP connection
> exists, and Supabase carries the schema, the RLS policies, and the three demo logins.
>
> **Section 1, 10DLC, is the one line still open -- and it is worse than unticked.** *"Started
> 2026-09-24"* is not true of the funded account: no brand and no campaign exist there
> (`HUMAN_INTERVENTION.md:122`). Nothing was ever queued, so nothing is coming.
>
> **Section 5's submission target is wrong twice.** The brief says *"You'll have 5 business days
> from receipt to submit"*, and it was received 09-24, so the deadline is ~2026-10-01, not Sunday
> 2026-09-27. Enrique's own chosen submission moment is **2026-09-26 at 11:00 EST** -- today,
> not tomorrow.

# Unlock checklist — what only Enrique can do

Everything here blocks a build agent. Ordered by how long the queue is, not by importance.

## 1. TIME-CRITICAL, do first (external queue)

- [ ] **10DLC registration** in Telnyx Mission Control -> Messaging. Brand first, then campaign.
      Use case: Customer Care or low-volume mixed. EIN if available, else sole proprietor.
      Started 2026-09-24. Nothing we build can accelerate this.

## 2. Credentials (write into .env, do NOT paste into chat)

- [ ] `TELNYX_API_KEY` — Mission Control -> API Keys. One key covers voice, SMS, and email.
- [ ] `ANTHROPIC_API_KEY` — powers the chat brain
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — create a new project,
      any region close to us-east
- [ ] `DEMO_EMAIL` — where proposals land in the demo
- [ ] `DEMO_PHONE` — transfer target and SMS recipient, E.164 format (+1305...)

## 3. Account actions I cannot do headlessly

- [ ] **Netlify**: `netlify login` once in your terminal, or hand me a personal access token
- [ ] **GitHub**: `gh auth login` once, so the repo can be created and pushed
- [ ] **Telnyx SIP connection**: I create it via API, but confirm "Receive SIP URI calls" is
      enabled on it. Needed for the browser supervisor leg.
- [ ] **Telnyx Email**: confirm the shared sending domain works, or add a custom domain

## 4. Things I will do via API once the key exists

- Buy the phone number and attach it to the assistant
- Create the AI Assistant "Sol" from agent/sol.md
- Register webhook tools and the transcript webhook
- Create the Credential SIP Connection for the supervisor
- Seed Supabase schema, RLS policies, and the three demo logins

## 5. Confirm before build agents start

- [ ] Submission target: Sunday 2026-09-27, to the address given in the brief
- [ ] Panel date once Katie schedules it (decides whether SMS is live or falls back to email)
