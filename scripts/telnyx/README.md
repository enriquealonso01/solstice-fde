# Telnyx scripts

The voice channel is a Telnyx AI Assistant named Sol. These scripts configure it and export it.
All of them read `TELNYX_API_KEY` and the other `TELNYX_*` keys from `.env`.

## `provision.mjs`

Creates or reuses, by stable name: the call control application (webhook `/api/telnyx`), the phone
number `+13057866217`, the assistant, the SIP connection and WebRTC credential for the browser
supervisor, then writes the resulting ids back to `.env` (with a `.env.bak` first).

The assistant's instructions are the `SOL:SYSTEM` block of `agent/sol.md` plus one line saying the
conversation is a phone call. Its tools are every name in `shared/toolContracts.ts`: concierge and
routing tools post to `/api/tools/<name>`, group tools to `/api/group/tool`, all with the
`x-solstice-tool-key` header from `TOOL_WEBHOOK_SECRET`. `transfer_to_human` becomes Telnyx's
native transfer, and a native `hangup` is added.

| Command | What it does | Safe to run? |
|---|---|---|
| `node scripts/telnyx/provision.mjs --dry-run` | Prints the full plan | Yes: no network calls |
| `node scripts/telnyx/provision.mjs --instructions-only --dry-run` | Prints the method, URL, body keys and instruction length | Yes: no network calls |
| `node scripts/telnyx/provision.mjs --check` | Reads the account balance | Yes: one GET |
| `node scripts/telnyx/provision.mjs --instructions-only` | Replaces the live assistant's instructions only, then reads it back and reports whether anything else changed | Changes the live phone agent's prompt |
| `node scripts/telnyx/provision.mjs --refresh` | Re-sends the whole assistant: instructions, model, voice, tools | Changes live telephony config |
| `node scripts/telnyx/provision.mjs` | Full provisioning | Changes live config |
| `node scripts/telnyx/provision.mjs --buy --area-code=305` | Buys a new number | Costs money |

After editing the `SOL:SYSTEM` block, run `--instructions-only` (the old name
`--refresh-instructions` does the same), then re-export. Use `--refresh`
only when the tools or voice settings change: it also sends `TELNYX_ASSISTANT_MODEL`, which
defaults to `openai/gpt-4o` when unset.

`TOOL_WEBHOOK_SECRET` must match in `.env` and in the Netlify environment, or every tool call from
the phone returns 401.

## `export-assistant.mjs`

```bash
npm run telnyx:export
```

One GET of the live assistant, written to `exports/telnyx-assistant.json` with the webhook secret and
SIP usernames redacted; it refuses to write the file if either survives. It also prints whether the
live instructions match what `agent/sol.md` compiles to. Safe to run: it changes nothing at Telnyx.
