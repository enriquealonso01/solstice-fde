# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 76 — 2026-09-25 ~18:17 EST

### Inbox empty. No lock held. One new commit (#67), log-only.

### I got the re-provision rule wrong last iteration, and corrected it

I wrote *"no deploy, no re-provision"* for PR #66, and the rule *"anyone editing sol.md between
lines 127 and 221 must deploy and re-provision Telnyx."* **The first clause is right; the rule is
wrong**, and it would have told the next person to skip a re-provision they needed.

The two marker systems govern **different runtimes**, and I collapsed them:

- `SOL:SYSTEM:BEGIN/END` (`sol.md:127-221`) bounds what the **chat** runtime extracts.
- `provision.mjs:224-227` compiles the **whole file** minus front matter, `voice:exclude` blocks
  and HTML comments — it never reads the `SOL:SYSTEM` markers.

So **any edit to `agent/sol.md` outside a `voice:exclude` block changes the phone agent.** PR #66's
hunk 1 (lines 81-99) is outside `SOL:SYSTEM` — chat genuinely untouched, my md5 check was right —
but inside the voice compile, so it **did** need `--refresh`. Hunk 2 (~368) sits inside a
`voice:exclude` block, which is why assumption 16 never leaked.

### An agent had already re-provisioned. I verified it rather than trusting the log

```
live instructions chars: 29315     local voice compile: 29315
  "reaches Sales"            : false
  concierge supervisor queue : true
  assumption 16 leaked       : false
```

**The log is accurate.** T19 is live on the phone agent, not just merged. Balance untouched at $3.09.

### The shape of the error, since it is one I keep making

I measured the **chat** path, found it unaffected, and wrote a rule covering **both** runtimes.
Same shape as the `sed` line-number correction and the `head_limit` truncation: the measurement was
sound, the generalisation from it was not. **Verifying one runtime is not verifying the other.**

The system caught this and I did not — the re-provision happened because an agent read the file
rather than my rule. Following what I wrote, the phone agent would still be saying *"reaches
Sales"* while `agent/sol.md`, the deliverable, said it does not.

### The plan is accurate and correctly ordered

**Enrique, in order:** the SQL paste · Telnyx top-up · **T21** two rows.
**Agents, one item:** re-export the Telnyx JSON — **28,678** vs live **29,315**. The gap was 95
characters and is now **637**: the export is two changes behind (#56, #66), and it is the *native
export* deliverable, so it should match what a reviewer pulls from Telnyx.
**Guardrails 18 of 19**, send-gate RLS path logged BLOCKED pending the migration.

### The single most important remaining item

**The `drop policy` paste.** It closes a live hole *and* restores `agent/sol.md` §13 exactly as
written, with no edit to any deliverable. Everything else left is a demo beat, two rows, or a file
refresh.
