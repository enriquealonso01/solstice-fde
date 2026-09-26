# planner status

What I am doing right now, and what I did last. Overwritten each iteration.
**Note:** this file is overwritten, not appended — a committed copy longer than the working one is
an *older* status, not a fuller one. See T24.

## Iteration 140 — 2026-09-25 ~23:22 EST

### The plan is accurate and correctly ordered. Suite 586, deploy current with HEAD.

### Verified PR #135's capability-URL disclosure in all three particulars

```
unauthenticated GET of the stored URL   200 · 2,570 bytes · application/pdf
one character altered in the filename   400
anonymous bucket listing                rejected — authorization required
```

**All three hold.** The URL is the whole credential, the path is not guessable, the bucket cannot be
enumerated — exactly what the README now says, with an honest framing (*"no login, no expiry, no
revocation, and forwarding the email forwards the access"*) rather than a generous one.

### The near-miss, same shape as three others tonight

My first test **built the URL by hand** and got **400** — which reads as *the disclosure is wrong*.
**`pdf_path` stores a full URL, not a path**, so my construction double-prefixed it. The stored
value as-is returns 200.

> **I built the input; the system did not.** Same as `inquiry_id` vs `inquiry_code` (It97), the
> `head -14` column read (It95), the hand-rolled compile (It86). **Correct measurements of the wrong
> thing**, each settled by reading what the system actually stores.

### The "one defect" count still holds

`README:117` says **one defect**; `README:211` adds **a stated limit**. Not a second defect — the
limits section already carries four others (session-identity binding, supervisor audio, idle-session
count, email sandbox). **A disclosed design choice and an open defect are different categories**, and
this package keeps them apart deliberately.

### The single most important remaining item

**The `drop policy` paste.** **T44** is the only agent item.
