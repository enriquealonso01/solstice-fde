# Submission

What goes to phData, and the note that goes with it.

---

## What to send

**1. The live system.** https://solstice-hotel-group.netlify.app — and the phone number,
**+1 (305) 786-6217**, which is the part nobody expects to actually work.

**2. The repository.** https://github.com/enriquealonso01/solstice-fde

It is **public**. Nothing secret is in it: `.env` and `DEMO_LOGINS.md` are gitignored, the Telnyx
export has its shared secret redacted, and history was scanned for every live credential before
the repository was opened. The demo password was rotated at that point, because an earlier value
was present in history and history is permanent.

**3. Staff credentials**, in the email body and **never in this repository**, which is public:

```
Concierge supervisor   supervisor@solsticehotels.com
Group sales            sales@solsticehotels.com
Super admin            admin@solsticehotels.com
Password (all three)   see DEMO_LOGINS.md, gitignored, on Enrique's machine
```

Sign in at `/login`. Paste the password into the email; do not commit it here.

---

## Where the graded items are

| The brief asks for | Where |
|---|---|
| Source code | the repository |
| Agent configuration `.md`: prompts, tools, guardrails | `agent/sol.md` |
| Sample transcripts | `transcripts/` — five chat, one real phone call. Start with `honest-handoff.md`: asked point blank whether a human is joining, Sol says no |
| Architecture diagram, future state | `docs/architecture.drawio`, `docs/architecture.svg` |
| Integration recommendation | `docs/integration-recommendation.md` |
| Native platform export | `exports/telnyx-assistant.json` |
| Latency target and its justification | `docs/latency-target.md` |
| Net-new tool | the same-day availability service, `netlify/functions/tools/availability.ts`, consumed by `check_late_checkout` and `check_upgrade_eligibility` (and `check_availability` on the group side), documented in `agent/sol.md` §4 and the README |

Two things they did not ask for, which answer their email rather than the PDF:

- `docs/how-this-was-built.md` — the six agents, and the bugs they found in each other's work
- `docs/where-this-goes.md` — the vision, in outcomes
- `docs/role-walkthroughs.md` — the three staff roles click by click, and what each click proves.
  Start here if you want the staff side without a guided demo.

---

## Suggested email

> Hi Katie,
>
> Here is the FDE project challenge.
>
> **Live system:** https://solstice-hotel-group.netlify.app
> **Call Sol directly:** +1 (305) 786-6217 — ask about checkout times, a late checkout, or
> whether you can bring a dog.
> **Code:** https://github.com/enriquealonso01/solstice-fde
>
> To see the staff side, sign in at /login:
> supervisor@solsticehotels.com · sales@solsticehotels.com · admin@solsticehotels.com
> Password for all three: <paste from DEMO_LOGINS.md>
>
> A few things worth trying, because they are the parts I would want to see:
>
> - Ask the chat what parking costs. It refuses to quote a number, because Policy 12 says there
>   is no chain-wide parking rate. That refusal is the whole design in one answer.
> - Open INQ-2007 in group sales. Your sample data contains a suite rate of −395 and a referral
>   to a Boston property that is not in the directory. Both are handled, neither is invented.
> - On the admin Backend page there is a failure-injection panel. Take the property management
>   system offline and ask the chat for a late checkout: it stops confirming what it can no
>   longer verify, while policy questions keep working.
>
> The README lists every deliverable and the assumptions I made. `docs/how-this-was-built.md`
> covers the agent-driven build, including what the agents got wrong.
>
> Happy to walk through any of it.
>
> Enrique

---

## Say this plainly, do not bury it

Two things are built but not live, and claiming otherwise would be the worst possible start:

- **SMS delivery.** US carrier registration takes days and I started it late. The delivery layer
  picks email or SMS from config, so it is a switch rather than a rewrite.
- **The supervisor ladder, partly.** Verified live: the supervisor attaches to an in-progress
  call, hears the guest, and "take over" really does stop Sol and leave the call up. Sol's own
  audio does not reach the supervisor leg, which is an undocumented edge of supervising an
  assistant call. The live transcript carries both sides, so nothing is hidden. The fix is a
  conference-based join, written up and deliberately not built this close to submission.

---

## Before sending, check

- [ ] Repository visibility decided, reviewers can open it
- [ ] `npm run demo:tidy` — no phantom "active" sessions on the supervisor dashboard. **Do this
      last.** Every chat opened while testing leaves a session marked `active`, so running it
      early and then testing again undoes it.
- [ ] Failure-injection switches all showing healthy
- [ ] Telnyx balance above $20, or do not invite them to call the number
- [ ] The live site loads and the chat bubble answers
- [ ] `npx vitest run` is green
- [ ] **Production is actually serving your latest commit.** Merging is not deploying, and a deploy
      can fail silently: one errored at 18:45 on 2026-09-25 and left `main` ahead of production
      until a retry two minutes later. Nobody was notified. Run this last, after any final change:

      ```bash
      set -a; . ./.env; set +a
      SITE_ID=$(node -e "console.log(require('./.netlify/state.json').siteId)")
      HEAD_ISO=$(git log -1 --format=%cI)
      npx netlify api listSiteDeploys --data "{\"site_id\":\"$SITE_ID\"}"         | HEAD_ISO="$HEAD_ISO" node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const head=new Date(process.env.HEAD_ISO)
        const ready=JSON.parse(s).find(d=>d.state==='ready')
        if(!ready){console.log('NO READY DEPLOY - do not send');process.exit(1)}
        const when=new Date(ready.created_at)
        console.log('last commit :',head.toISOString())
        console.log('last ready  :',when.toISOString())
        console.log(when>head?'OK - production is serving your latest commit'
                             :'BEHIND - your last commit was never deployed. Deploy before sending.')
      })"
      ```

      It prints `OK` or `BEHIND`, so there is nothing to eyeball: git reports local time
      (`15:00:29-04:00`) and Netlify reports UTC (`19:00:40Z`), and comparing those by eye at the
      end of a long night is its own way to get it wrong. Two failures are covered — a deploy that
      **errored**, because only `state: ready` counts, and a deploy that **never happened**, because
      a ready deploy older than your last commit means production is behind. Do not read a passing
      state alone as a pass.