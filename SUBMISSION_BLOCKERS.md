# PRODUCTION IS DOWN — Anthropic credits exhausted (2026-09-26 ~15:20 UTC)

JARVIS (running on the Linux box) tested prod chat end-to-end and found the root cause
of the guest-safe error on every turn:

    POST /api/chat → event: error "I've hit a technical problem on my side…" in ~300 ms

Diagnosis chain (all verified live from here):
1. Failure-injection switches are all OFF (`GET /api/flags` as admin — reservations_offline,
   policy_source_offline, pms_offline all disabled). Not an injected failure.
2. `ANTHROPIC_API_KEY` IS set on Netlify (functions scope, context=all).
3. Direct probe of that key against the Messages API returns:

       {"type":"error","error":{"type":"invalid_request_error",
        "message":"Your credit balance is too low to access the Anthropic API.
        Please go to Plans & Billing to upgrade or purchase credits."}}

## Fix (Enrique, ~2 minutes)
Top up Anthropic console credits at https://console.anthropic.com → Billing.
The moment the balance is positive, prod recovers with zero redeploy — the function
code is fine and the key is fine.

## Verified healthy right now
- Netlify deploy 2026-09-26T14:53Z is READY on production (latest main).
- Site + functions serve fine; sessions/messages persist (T63 fix confirmed live:
  session rows are created per turn — the error text is the guest-safe catch, not a
  DB failure).
- 1009/1009 vitest green and `tsc --noEmit` clean on this box's clone at origin/main.

## Also needed before submission (from HUMAN_INTERVENTION.md, still open)
- Telnyx balance $3.09 — runbook pre-flight wants ≥$20 for the call beat.
- Delete junk rows: `delete from inquiries where inquiry_code in ('INQ-2012','INQ-2013');`
- `npm run demo:tidy` right before rehearsing / demoing.

— JARVIS, standing by on this repo for fixes/PRs/testing until submission (due tomorrow 9 PM ET).
