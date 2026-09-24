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

- [ ] Submission target: Sunday 2026-09-27 to kdesotell@phdata.io
- [ ] Panel date once Katie schedules it (decides whether SMS is live or falls back to email)
