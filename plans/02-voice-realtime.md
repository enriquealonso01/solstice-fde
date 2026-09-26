> ## Correction, 2026-09-26 -- the risky assumption was tested, and it half-held
>
> *Prepended at implementer iteration 127; **nothing below is edited**. The research here was right
> about the mechanism. One live call moved two things.*
>
> **The Listen row overstates what a supervisor hears.** It says *"Supervisor hears both sides"*.
> On a live call the supervisor hears the **guest only**: Telnyx documents `monitor` as hearing
> everything, but a leg running an AI assistant appears to inject Sol's synthesized speech rather
> than stream it, so Sol's half never reaches the monitor. The live transcript carries both sides
> regardless, so the supervisor is never blind -- `README.md` states that limit in the deliverable
> rather than hiding it, under *"Partly working, and stated precisely because it matters"*. Cited by
> that sentence rather than by a line number: it was `:179` when this correction was written at
> iteration 127 and `:185` by 130, and both moves were edits higher up the README, not changes to the
> claim. A quotation survives what a line number does not.
>
> **"TEST FIRST" item 1 is answered, and the answer is yes.** `supervise_call_control_id` does work
> against a leg running `ai_assistant_start`: the supervisor attaches, and `ai_assistant_stop`
> genuinely silences Sol while leaving the call up. The conference fallback is therefore not needed
> for the reason this section gives. It is now the documented fix for the *audio* gap above
> instead, and it is written up and deliberately not built, because it would rework the inbound
> flow that currently answers the phone reliably. That write-up is in
> `netlify/functions/voice/supervisor.ts:13` onward, which still calls this the single riskiest
> assumption in the voice path -- it was, and it is now settled.
>
> Item 2 is untouched: word-level interim transcription was never needed and was never tried.

# Voice: live transcripts + human takeover (RESOLVED)

Research verified 2026-09-24. Both requirements are buildable.

## Live transcripts during an active call — SUPPORTED

Start the assistant with history updates enabled:

```
POST /v2/calls/{call_control_id}/actions/ai_assistant_start
{ "assistant_id": "...", "send_message_history_updates": true }
```

Fires **call.ai_gather.message_history_updated** during the call, once per conversation turn,
carrying cumulative history with role = assistant | user.

Gotcha: the event lives in the call.ai_gather.* namespace even when started via
ai_assistant_start. Do not filter on call.conversation.*.

Granularity is TURN-LEVEL, not word-by-word. Fine for a supervisor dashboard, and that is what we
tell the panel. Word-level interim would need transcription_start with interim_results: true,
which is UNCONFIRMED as concurrent with an active assistant. Not needed.

Pipeline: Telnyx webhook -> Netlify function -> Supabase messages insert -> Supabase Realtime
-> supervisor UI updates live. Same table backs the post-call archive: one transcript path, not two.

Post-call only (do not confuse): call.conversation.ended, call.conversation_insights.generated.

## Human takeover — SUPPORTED, assembled from Call Control primitives

No single "supervisor" button exists in the AI Assistant product. We build the ladder:

| Rung | Call | Effect |
|---|---|---|
| Listen | POST /v2/calls with supervise_call_control_id + supervisor_role monitor | Supervisor hears both sides, nobody hears them |
| Whisper | switch_supervisor_role -> whisper | Only the agent side hears the supervisor |
| Barge | switch_supervisor_role -> barge | Everyone hears the supervisor |
| Take over | POST /v2/calls/{assistant_leg}/actions/ai_assistant_stop | AI goes silent, call stays live |

ai_assistant_stop docs, verbatim: "The call remains active and can continue with other call
control commands."

Supervisor joins from the BROWSER, not a phone:
1. @telnyx/webrtc logs in against a Credential SIP Connection, registers as
   supervisor@sip.telnyx.com (enable "Receive SIP URI calls")
2. Dial the supervisor leg with to: sip:supervisor@sip.telnyx.com plus
   supervise_call_control_id and supervisor_role
3. Escalate the role live via switch_supervisor_role
4. ai_assistant_stop for the full handoff

Demo moment: supervisor watches the transcript stream, clicks Listen, then Take over, and finishes
the call as a human. Sol steps aside without dropping the guest.

## TEST FIRST (both undocumented, neither blocking)

1. Does supervise_call_control_id work against a leg running ai_assistant_start? Mechanically it
   is an ordinary Call Control leg, so it should. Not documented either way.
   FALLBACK: run the assistant in a conference and have the supervisor join with supervisor_role.
   Conference + assistant is explicitly documented as a real combination.
2. Whether transcription_start can run concurrently with an active assistant. Only matters for
   word-level interim, which we do not need.

Avoid streaming_start as a DIY transcript tap: error 90045 indicates command conflicts.

## Assistant-side handoff tools

- Transfer: targets can be a phone number OR a SIP URI
- warm_transfer_acceptance: assistant consults the destination privately while the caller hears
  ringback, then complete_transfer. Works only with ai_assistant_start, which is our path
- SIP Refer: cheaper handoff, Telnyx leaves the media path
