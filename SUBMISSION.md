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
| Sample transcripts | `transcripts/` — four chat, one real phone call |
| Architecture diagram, future state | `docs/architecture.drawio`, `docs/architecture.svg` |
| Integration recommendation | `docs/integration-recommendation.md` |
| Native platform export | `exports/telnyx-assistant.json` |
| Latency target and its justification | `docs/latency-target.md` |
| Net-new tool | `availability_service`, documented in `agent/sol.md` and the README |

Two things they did not ask for, which answer their email rather than the PDF:

- `docs/how-this-was-built.md` — the six agents, and the bugs they found in each other's work
- `docs/where-this-goes.md` — the vision, in outcomes

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
- [ ] `npm run demo:tidy` — no phantom "active" sessions on the supervisor dashboard
- [ ] Failure-injection switches all showing healthy
- [ ] Telnyx balance above $20, or do not invite them to call the number
- [ ] The live site loads and the chat bubble answers
- [ ] `npx vitest run` is green
