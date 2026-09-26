# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 171 — 2026-09-26 02:05 EST

**The plan is accurate and correctly ordered. No agent task is open.**

### The approval gate holds in the live data

With the `group_sales` token, all ten proposals, using the code's own predicate (`store.ts:448`,
`status === 'flag' || 'fail'`):

| proposal | status | blocking | approver |
|---|---|---|---|
| PRP-2001 · 2001-2 · 2001-3 · 2006 | **sent** | **0** | none needed |
| PRP-2005 · 2007 · 2008 · 2009 | **awaiting_approval** | 2 · 2 · 3 · 1 | none |
| PRP-2002 | rejected | 2 | none |
| PRP-2011 | draft | 0 | none |

```
SENT with blocking verdicts and NO approver:  none
```

**Every proposal carrying a blocking rule is parked or rejected; every sent proposal carried none.** Real
rules: `GRP-DISCOUNT-CEILING`, `GRP-ROOMS-CAP`, `GRP-OVERFLOW-ROUTING`, `GRP-INSURANCE-CERT`,
`GRP-MEETING-CAPACITY`.

**What this adds to item 1:** the RLS hole is a bypass that **exists and has never been walked through.** The
disclosure says a rep *can* approve their own flagged proposal — a capability, not an event — and the live
audit state confirms nobody has. **Applying the paste closes a door with nothing behind it.**

### Precision fix to my own banner

Querying `proposals.approved_by` returned `42703: column does not exist`. **It is not a column** — it is
persisted inside `pricing.__proposal` (`store.ts:215-225`) and written to `audit_log` by `approveProposal`.
My banner said *"`approved_by` stays null"*, implying a column a reviewer will not find in `schema.sql`.
Changed to **"unset"** plus one clause saying where it lives. The substance was right: PATCHing `status`
directly skips `approveProposal`, the sidecar is never written, and `assistant.ts:196`'s
`?? 'an authorised approver'` falls through to the phantom.

### Ninth instrument slip — and an impossible result was the tell

My first pass guessed the verdict shape (`blocks`/`severity`/`passed`) and reported **zero blocking verdicts
on all ten**, including four sitting in `awaiting_approval`. **Four proposals parked for approval with
nothing to approve is not a finding, it is an impossibility.** Read one verdict object and
`blockingVerdicts()` instead of guessing again: the real shape is `status: 'pass' | 'flag' | 'fail'`.

**Reach for the code's own predicate rather than inventing one** — `blockingVerdicts` was six lines away and
exported.

### Open

| # | Item | Owner |
|---|---|---|
| 1 | **`drop policy` ×3.** Reads proven live (13/10/3); **gate proven clean**. Write policies: Tester's 20:26 check, not re-provable by me | Enrique — **do** |
| 2 | **Top up Telnyx** — under $4 and falling; Billing, ~$30 | Enrique — **do** |
| 3 | **T21** — delete `INQ-2012`/`INQ-2013`, cascade count first. Inbox still holds **13** | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF in history.** Fixed and guarded. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |
| — | **Auto-triage re-verification** — service-role or signed-in rep required | **a Tester** |

**Tester silent 5h39m.** Inbox empty. No lock held. The Implementer is on It127 auditing `plans/01`–`04`;
I stayed off it.

### The single most important remaining item

**The `drop policy` paste** — and it is now the best-evidenced item on the list: the reads it depends on have
been watched serving rows, and the gate it protects has been shown never to have been bypassed.
