# Agent working agreement

> ## Update, 2026-09-26 — what below is superseded
>
> **Nothing below is edited.** It is the agreement the build started under, and it is worth reading as
> that. Three things in it are no longer true, and a reader should know which before taking the rest
> literally.
>
> **The "Known blockers" section is resolved, all three.** Measured this morning, not remembered:
> Telnyx carries **$3.03** and the number `+13057866217` is on the account, so calls and email work and
> the outstanding item is a top-up rather than a purchase; `POST /api/chat` on production returns
> **200** with a grounded answer, so the Anthropic key is fine; and `supabase/schema.sql` is applied,
> proven by a service-role read of `sessions` returning **200**. The email path is proven end to end,
> with Telnyx's sandbox domain the only limit. What is still open is listed in
> `HUMAN_INTERVENTION.md`, which is the live list.
>
> **Non-negotiable 2, "Do not run git. The orchestrator commits", no longer describes how this repo
> works.** Enrique's standing instruction has each shipping agent branch, commit, push, open a PR,
> squash-merge and deploy, holding `agents/.lock` for the whole sequence. That protocol — including
> what to do when the lock is held, when your own `rmdir` fails, and when another agent writes to their
> files mid-ship — is documented in **`agents/README.md`**. Read that, not this, for how to ship.
>
> **Non-negotiable 3's shared-shell list has moved.** `src/lib/supabase.ts` and `package.json` have both
> been changed deliberately since — the first so the app survives an unconfigured `.env` rather than
> rendering a white screen, the second to add the `demo:preview` script. The spirit of the rule stands;
> the file list is a snapshot.
>
> Everything else — the grounding rule, the PII rule, rules-as-data, integer cents, the two planted
> data traps and the seasonal caps — is current and was verified this session.


Read `plans/00-requirements.md` and `plans/01-build-plan.md` before writing code.
`plans/02-voice-realtime.md` and `plans/03-messaging.md` carry the verified Telnyx API details.

## Non-negotiables

1. **Stay inside the files you own.** Another agent is editing the rest of this repo right now.
   Never edit a file outside your ownership list. If you need a change there, note it in your
   final report instead.
2. **Do not run git.** No commit, no push, no branch, no stash. The orchestrator commits.
3. **Do not edit** `src/App.tsx`, `src/main.tsx`, `index.html`, `src/index.css`,
   `src/lib/supabase.ts`, `src/components/RequireRole.tsx`, `shared/types.ts`,
   `shared/toolContracts.ts`, `vite.config.ts`, `tailwind.config.js`, `package.json`.
   These are the shared shell. Ask for changes in your report.
4. **Run `npm run typecheck` before you finish.** Fix your own type errors. Errors in files you
   do not own are not yours to fix, but report them.
5. **Never invent hotel facts.** Policy, rate, and availability answers come from the provided
   data or they escalate. This is the core requirement of the whole challenge.
6. **Never log or expose unmasked PII.** Payment digits, full email, full phone.
   Masking happens in the tool/data layer, never in a prompt.

## Known blockers (work around, do not stall)

- **Telnyx balance is $0.00**, so no number can be bought and no call or email can be sent yet.
  Write the code, make it configurable, and make failure paths explicit. Do not retry live calls.
- **The Anthropic key is not workspace-scoped** and currently 400s. Write code against the API
  contract; do not block on a live response.
- **The Supabase schema may not be applied yet.** `supabase/schema.sql` is the contract. Write
  code against it; guard for missing tables with a clear error rather than crashing.

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Every tool returns the `ToolResult` envelope from `shared/types.ts`, including `grounded`
  and `citations`. `grounded: false` means the agent must escalate, never improvise.
- Tailwind only, using the `solstice` palette in `tailwind.config.js`. Reuse `.panel`,
  `.btn-primary`, `.btn-ghost`, `.chip` from `src/index.css`.
- Serverless functions live in `netlify/functions/`, reached from the browser at `/api/<name>`.
- Business rules are data in `src/lib/rules/`, never prose inside a prompt. The panel will ask
  us to change a threshold live; that must be a one-line edit.
- Currency as integer cents where arithmetic happens.

## The data, and its deliberate traps

`data/` holds the four provided files. Two landmines we exploit on purpose:
- `SOL-PVD.base_rate_suite = -395`. A negative rate. Validate and quarantine it; never price off it.
- `SOL-PVD.notes` routes blocks over 15 rooms to a "Boston-area sister property" that does not
  exist in the directory. Surface the referral without inventing inventory.

Seasonal caps hide in free-text `notes` (Denver ski weekends 8%, Sacramento legislature weeks 8%,
Chicago 2-week lead time over 25 rooms, Columbus youth-group insurance certificate). Parse them
into structured rules; do not hope the model notices them at runtime.

## Demo truth

The demo is a split screen: guest on one side, admin on the other. Anything that happens on the
guest side must appear on the admin side within about a second.
