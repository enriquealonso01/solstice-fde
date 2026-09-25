# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 77 — 2026-09-25 ~18:24 EST

### Inbox empty. No lock held. Deploy current with HEAD (`ready 22:18:40Z` / `HEAD 22:18:32Z`).

### PR #69 is live, and it fixed a real bug

`create_escalation` fired twice in one conversation — **5 of 31 sessions**, going back to
**2026-09-24 17:55**, a day before the change that surfaced it. Single-turn harness runs produce
one row, which is why every earlier test of this path looked clean.

Three things worth keeping: the Implementer **checked whether they had caused it** before reporting
it; the guarantee went **in the tool, not the prompt** (*"do not call this twice"* is a rule a model
follows most of the time); and **category is part of the merge key deliberately**, so a group
enquiry that becomes a safety report still opens its own row.

### I checked the leftover rows expecting a second T21. They are invisible

The fix stops new duplicates but does not clean old ones, and **`demo:tidy` does not touch
escalations at all**:

```
total escalation rows: 38
session+category groups with >1 row: 4   (all open,open)
```

So it looked exactly like "DELETE-ME at row one". **It is not: escalations have no UI surface.**
Every `src/` reference is the architecture backend-map drawing the table as a *node*, or a chat
tool label. No component queries it, no function lists it. Only `tools/escalation.ts` touches it.
A panel cannot see these rows.

**No task, no cleanup needed.** Recorded because the conclusion is the opposite of the one I
expected, and the next person will have the same instinct.

### One residual nuance, and I recommend not acting on it

`sol.md:89` says the row *"reaches the concierge supervisor's queue"*. True at the layer that
matters — `esc_read` scopes the table to `concierge` and `admin` — but **"queue" implies a screen,
and no screen renders escalations**. Leave it: the sentence is **not false**, unlike *"reaches
Sales"* which RLS actively contradicted; and per my iteration-76 correction, any `sol.md` edit
outside a `voice:exclude` block now costs a **second voice re-provision**.

**Panel answer ready:** *today that queue is the table itself, durable and RLS-scoped; the console
view is the next build.* **Bundle the clause into any other `sol.md` edit; do not re-provision for
it alone** — same policy as `chat.ts:146`.

### PR #68 invalidated earlier browser role evidence, and it has been re-verified

`Network.clearBrowserCookies` never signed the harness out — Supabase keeps the session in
`localStorage` — so earlier browser runs ran as whoever logged in last. Both harnesses now wipe
origin storage and abort unless the page names the expected role. Role scoping re-verified at four
layers with real tokens, and PR #55 re-verified on a role-confirmed session. **No open claim is
left resting on the broken harness.**

### The plan is accurate and correctly ordered

**Enrique, in order:** the SQL paste · Telnyx top-up · **T21** two rows.
**Agents, one item:** re-export the Telnyx JSON — 28,678 vs live 29,315.
**Guardrails 18 of 19**, send-gate RLS path logged BLOCKED pending the migration.

### The single most important remaining item

**The `drop policy` paste.** It closes a live hole *and* restores `agent/sol.md` §13 exactly as
written, with no edit to any deliverable.
