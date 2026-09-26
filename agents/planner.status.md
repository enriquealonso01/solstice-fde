# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 238 — 2026-09-26 08:10 EST

**One small agent task is open: T62.** T61 shipped at 08:06, one minute after I filed it.

### T61, and a sharper hazard than the one I filed

`.gitignore:21` now carries `.scratch-*/`, and its comment names the real risk: not *"`git add -A` ships it"*
but *"**vitest has no include config**, so its default collects any `*.test.ts` under the project root and a
half-written file inside one turns the SHARED suite red."* **An unignored scratch directory defeats the purpose
of the rule that creates it.** I confirmed the first half — `vite.config.ts:19` is
`test: { setupFiles: ['./vitest.setup.ts'] }`, no `include`, no `exclude`. *Whether the default glob descends
into a dot-prefixed directory I did not test, because testing it means putting a `.test.ts` in the repository.*

### Then I read `vitest.setup.ts`, which several claims rest on and I never had

34 lines, deleting **ten** environment keys in a `beforeAll`. **Hermeticity is intact** — Supabase, the Telnyx
API, Anthropic, the tool webhook and the proposal link secret are all stripped, which is what the file was
written for.

### The claim built on top of it does not hold

`no-committed-credentials.test.ts:106`: *"`vitest.setup.ts` strips credentials from the environment, **so no
test here can know the password's value.**"*

```
credential-shaped in .env and NOT stripped:
  DEMO_PASSWORD · NETLIFY_AUTH_TOKEN · TELNYX_SIP_PASSWORD · TELNYX_TELEPHONY_CREDENTIAL_ID
```

**`DEMO_PASSWORD` is the admin password in `DEMO_LOGINS.md`** — the exact value the sentence says no test can
know. **T62 filed:** three list entries make it true, and none of the three is referenced by a non-comment line
under `src/`, `netlify/` or `shared/`.

> **The "assertion holding its own copy of the answer" family, one level up: a justification holding a copy of a
> guarantee the code does not give.** Nothing leaks and nobody exploits it — what is wrong is that a reader
> judging whether the credential guard is adequate is told a value comparison is impossible, in the file whose
> whole job is to be trusted about credentials.

### Two things I checked and did not file

- **The strip runs in `beforeAll`, not at module scope**, so an import-time read would see the real value.
  **No instance exists** — the only module-scope `process.env` reads in the tree are `ANTHROPIC_MODEL` and
  `SOL_NARRATION`. Theoretical, so not a task.
- **`TELNYX_TELEPHONY_CREDENTIAL_ID` is referenced by two non-test files**, so T62 says read those first and
  notes an id is not a secret the way a password is.

### Open

| # | Item | Owner |
|---|---|---|
| **T62** | *"No test here can know the password's value"* — `DEMO_PASSWORD` is not stripped. Three list entries | any agent — small |
| 1 | **`drop policy` ×3** — **only Enrique can.** SQL at **609**, ***"### What to run"***. **Breaks nothing; verified three ways** | Enrique — **do** |
| 2 | **Top up Telnyx** — under **$3.01** at 06:45, no credit line, fewer than six calls, hard stop at zero | Enrique — **do** |
| 3 | **T21** — **delegable**: an agent has the key and declined on judgement | Enrique — **do** |
| 4 | **T34** — SIP credential. **Accept; no action** | Enrique — decide |
| 5 | **Brief PDF** — absent from the public tree. **Leave it; no action** | Enrique — decide |
| 6 | **Your own address in this file.** Removing it breaks nothing. **No recommendation** | Enrique — decide |

Suite green at **923 / 65 files**. Tester silent since 20:26 (**11h44m**); no open findings. Inbox and In
progress empty. No lock held; I took none. Plan guards re-run: **104 green**.

### The single most important remaining item

**The `drop policy` paste.** T62 is three list entries in a test-setup file. **The SQL is still the one action
nobody else can take.**
