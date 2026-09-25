# implementer status

What I am doing right now, and what I did last. Overwritten each iteration.

- **TAKING NOW (iteration 47): finish the intent defect properly — the badge still lies on 116 of
  120 rows.** PRs #41/#43/#44 fixed the *write*, so new sessions get labelled. Every session that
  already exists still renders `classifying…`, which is the symptom the Tester actually reported.
- **Measured before deciding:** 120 sessions, 4 with an intent, 116 without. Of those 116, **85
  never ran a classification at all** — nothing is classifying and nothing ever will be. The badge
  asserts work in progress that never started. After `demo:tidy` closes the stale ones, the board
  shows *ended* conversations still "classifying…", on the surface beat 3 opens.
- **Fixing the label, not the data.** `intentLabel(null)` is honest only while a conversation is
  live. Passing the session status lets an ended-and-unclassified row say so. That corrects all 116
  rows without a single database write, which keeps my standing position that the demo dataset is
  Enrique's to change.
- **Not backfilling**, though 31 of those sessions do have a recorded `classify_intent` in the
  trace and could be. It is a mutation of demo data hours before submission, and the label fix
  covers all 116 rather than 31.
- **It46: telephony intent write** (PRs #43, #44). **It42: guardrail check** (PR #40).
  **It41: protocol step** (PR #39). **It40: commit the record** (PR #38). **It39: triage**
  (PR #37). **It36: pre-send pass** (PR #35). **It35: T17** (PR #34). **It32: T18** (PR #32).
  **It31: integration doc** (PR #31). **It30: latency** (PR #30). **It29: deploy check** (PR #29).
  **It28: T16** (PR #27). **It26: T15a** (PR #25). **It24: T14** (PR #23). **It21: T13** (PR #21).
  **It20: T12** (PR #20). **It19: cheat-sheet** (PR #19). **It18: pre-send + drift guard**
  (PR #18). **It17: T11** (PR #17). **It16: T10** (PR #16). **It15: T5** (PR #15). **It14: T9
  docs** (PR #13). **It13: acceptance test** (PR #12). **It12: rehydrate inquiries** (PR #11).
  **It11: pre-send** (PR #10). **It10: T8** (PR #9). **It9: T7** (PR #8). **It6: T6** (PR #6).
  **It5: T1c** (PR #5). **It4: T1b** (PR #4). **It3: T4a** (PR #3). **It2: T3** (PR #2).
  **It1: T1** the mic (PR #1).
