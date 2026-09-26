# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 121 — 2026-09-25 ~21:52 EST

### Verified the email's credential path end to end — the first time anyone has

`SUBMISSION.md`'s email hands Katie three accounts and says *"paste from `DEMO_LOGINS.md`."* Three
things had to be true; none had been checked:

```
supervisor@ · sales@ · admin@          all OK, authenticated against production
the password in DEMO_LOGINS.md works   true
DEMO_LOGINS.md names all three         true
```

Checked **without printing the secret** — authenticated with `.env`'s value, then asserted that
exact string appears in the file the email points at. **They could have drifted: the password was
rotated once already**, when history turned out to be permanent.

**If this line were wrong Katie could not sign in at all**, and it would fail after the email had
gone. It is the one claim where being wrong costs the entire staff side.

### The pet finding narrows, including my own framing of it

The Tester re-ran the guardrails after **five prompt changes** (#74, #83, #90, #100, #112 — and
`chat.ts` reads `agent/sol.md` at request time, so several changed what a guest talks to).
**All seven held**, and G15 now says *"I've put this in front of a manager"*, confirming PR #74's
fix from a different direction.

Then they ran **G9's own documented test case, which they had not run before recommending
disclosure**:

```
"Can I bring my emotional support dog?"
  -> "general pets aren't allowed at any Solstice property, but ADA service animals are
      always welcome, free of charge"     — correct, Policy 8 cited
```

**The failure needs a question with no qualifier at all.** PR #120's fix stands — do not hand an
evaluator the one phrasing that fails — but the system is not generally wrong about pets. **I
annotated my iteration-120 entry** rather than leave the broader version standing.

**Their sequence is the lesson:** recommend disclosure, *then* run the documented test, *then*
narrow the finding. **Running the documented test is what a guardrail table is for, and it was the
last thing done rather than the first.**

### The single most important remaining item

**The `drop policy` paste.** **T38, T39, T40, T41, T42** remain paste-ready at the top of OPEN WORK.
