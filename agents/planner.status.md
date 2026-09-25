# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 84 — 2026-09-25 ~19:06 EST

### Inbox empty. Lock held. Guardrails 18 of 19.

### The re-export is done, and I checked bytes rather than length

```
live    29315  834d62ff327b4d0ecc5b6a48f073db12
export  29315  834d62ff327b4d0ecc5b6a48f073db12   identical: true
```

Also carries **25 tools** and `model: anthropic/claude-haiku-4-5`. In the working tree,
uncommitted, lock held. **That was the last ordinary agent item.**

### The model claims hold, checked against the deployed environment

README:45-46 claims chat is **Sonnet 5** and phone is **Haiku 4.5**, and `latency-target.md` argues
at length for *not* moving chat to Haiku. That argument is only honest if chat really runs Sonnet.
**`ANTHROPIC_MODEL` is unset on the deployed site**, so `chat.ts:56`'s `claude-sonnet-5` default
applies; the export confirms voice is Haiku. **Both true, reasoning intact.**

### T33 revised again — and away from a code change

I read the **deployed** environment rather than `.env`: **`TELNYX_TRANSFER_TARGET` is unset in
production.** So `transferToHuman`'s fallback is the **live configuration**, not a test condition,
and it says *"a manager will call them back today."*

That puts "today" in **three** places — and the third decides it: `agent/sol.md:283` defines **G16**
as correct when Sol says *"a manager will call back today, and an escalation exists."* **The phrase
is part of a guardrail's success criterion.**

**The steelman I had been discounting is right: Policy 15 genuinely specifies same-day routing.**
Sol is reporting hotel policy, which is what a concierge agent should do. What is missing is a
**notification layer**, which the diagram already marks **FUTURE**. The gap is policy-versus-
implementation and belongs in the architecture section, not the guest sentence.

**Revised: change no wording.** One `voice:exclude` paragraph in `sol.md` on what "today" rests on,
one runbook line for the panel question. **This supersedes my own iteration-83 instruction** to
remove the timing — that was right only while the timing looked like an accident.

### Why this is not the over-caution I was wrong with earlier

In iteration 81 my reasons were claims about behaviour I had not measured, and they were wrong.
Here every step is a file and a line — three call sites, a guardrail definition, a policy — and the
mechanism says the sentence is *correct* while the thing behind it is missing and already disclosed.
**The one claim I cannot check without spending money — what the voice agent actually says — is
still marked unmeasured and still gated on the same call.**

### The plan is accurate and correctly ordered

**Enrique:** the SQL paste · **Telnyx top-up** (beat 3, G16, T33's one unmeasured claim) · T21.
**Agents:** commit the re-export · T33's disclosure paragraph, which absorbs T32.

### The single most important remaining item

**The `drop policy` paste** — still the only open item with a live security consequence.
