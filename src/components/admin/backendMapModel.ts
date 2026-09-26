// The system map, as data.
//
// This is the single model behind the in-app Backend page and the .drawio deliverable.
// Every node names the real provider. Every choice that had a plausible alternative
// carries the reason we did not take it, because that is the question the panel asks.
//
// Editing a node here changes what Enrique narrates. No component code involved.

import type { Edge, Node } from 'reactflow'
import type { BackendNodeData } from './BackendNode'

type N = Node<BackendNodeData>

const n = (id: string, x: number, y: number, data: BackendNodeData): N => ({
  id,
  type: 'backend',
  position: { x, y },
  data,
})

const e = (source: string, target: string, label?: string, animated = false): Edge => ({
  id: `${source}__${target}`,
  source,
  target,
  label,
  animated,
  style: { stroke: '#6B625A', strokeWidth: 2 },
  labelStyle: { fill: '#2E2A26', fontSize: 13, fontWeight: 500 },
  labelBgStyle: { fill: '#F7F3EC', fillOpacity: 0.95 },
  labelBgPadding: [6, 3],
  labelBgBorderRadius: 4,
})

export interface MapTab {
  id: string
  label: string
  blurb: string
  nodes: N[]
  edges: Edge[]
}

// ---------------------------------------------------------------- overview

const overview: MapTab = {
  id: 'overview',
  label: 'Whole system',
  blurb:
    'One deployed application. Two guest channels, one tool layer, one database. Nothing about the guest experience is a second app talking to the first.',
  nodes: [
    n('landing', 0, 20, {
      layer: 'guest',
      provider: 'Netlify',
      title: 'Hotel landing page',
      detail: 'Static React build on Netlify’s CDN. The stage, not the product.',
      why: 'The page has no server needs, so it should not pay for a server.',
      status: 'live',
    }),
    n('bubble', 0, 280, {
      layer: 'guest',
      provider: 'React',
      title: 'Chat bubble',
      detail: 'Streaming replies, typing indicator, tool-call chips, inline policy citations.',
      why: 'This is the deliverable. Everything else exists so this can answer honestly.',
      status: 'live',
    }),
    n('phone', 0, 560, {
      layer: 'guest',
      provider: 'Telnyx',
      title: 'Support phone number',
      detail: 'A real DID on the landing page. Sol answers with the same persona as chat.',
      why: 'Guests who call a hotel expect a voice, not a web form.',
      status: 'live',
    }),

    n('chatrt', 400, 200, {
      layer: 'runtime',
      provider: 'Anthropic',
      title: 'Chat runtime (Claude)',
      detail: 'Streams through /api/chat on Netlify Functions. We own turn-taking and the UI trace.',
      why: 'Streaming directly is what lets the guest watch the agent work instead of waiting on a spinner.',
      status: 'live',
    }),
    n('voicert', 400, 520, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'Voice runtime (AI Assistant “Sol”)',
      detail: 'Telnyx owns turn-taking, barge-in and the audio path.',
      why: 'Rebuilding interruption handling for telephony is weeks of work with a worse result.',
      status: 'live',
    }),

    n('tools', 800, 300, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'Shared tool layer',
      detail: 'Both runtimes call the same typed endpoints and get the same ToolResult envelope.',
      why: 'One tool layer is the only way voice and chat cannot drift apart on policy.',
      status: 'live',
    }),
    n('rules', 800, 600, {
      layer: 'tools',
      provider: 'In repo',
      title: 'Business rules as data',
      detail: 'Thresholds, seasonal caps and blackout windows live in src/lib/rules, never in a prompt.',
      why: 'The panel will ask us to change a threshold live. That must be a one-line edit, not a re-prompt.',
      status: 'live',
    }),

    n('db', 1200, 60, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Postgres + row level security',
      detail: 'Role scoping is a database policy. Concierge cannot read inquiries; group sales cannot read messages.',
      why: 'If scoping lives in the UI, the honest answer to “how do you know” is “we hope”.',
      status: 'live',
    }),
    n('realtime', 1200, 340, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Realtime',
      detail: 'postgres_changes on sessions, messages, tool_invocations, inquiries and proposals.',
      why: 'The demo is a split screen. The right half has about a second to react to the left half.',
      status: 'live',
    }),
    n('storage', 1200, 620, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Storage',
      detail: 'Generated proposal PDFs, delivered as signed URLs.',
      why: 'PDF over MMS has patchy carrier support. A link always arrives.',
      status: 'live',
    }),

    n('staff', 1600, 60, {
      layer: 'staff',
      provider: 'React',
      title: 'Staff surfaces, three scoped logins',
      detail: 'Concierge supervisor, group sales, super admin. Same bundle, different doors.',
      why: 'One app was a hard constraint. Scoping is enforced underneath it, not by shipping three builds.',
      status: 'live',
    }),
    n('delivery', 1600, 480, {
      layer: 'delivery',
      provider: 'Telnyx',
      title: 'Delivery adapter',
      detail: 'Email when there is an address, SMS when there is only a number, flagged when there is neither.',
      why: 'Swapping channels is config. When a provider fails, nothing above the adapter changes.',
      status: 'live',
    }),
  ],
  edges: [
    e('landing', 'bubble', 'embeds'),
    e('landing', 'phone', 'displays'),
    e('bubble', 'chatrt', 'streams', true),
    e('phone', 'voicert', 'PSTN', true),
    e('chatrt', 'tools', 'tool calls'),
    e('voicert', 'tools', 'webhook tools'),
    e('tools', 'rules', 'reads'),
    e('tools', 'db', 'writes'),
    e('chatrt', 'db', 'messages', true),
    e('voicert', 'db', 'transcript turns', true),
    e('db', 'realtime', 'publication'),
    e('realtime', 'staff', 'live updates', true),
    e('tools', 'storage', 'PDF'),
    e('tools', 'delivery', 'send_proposal'),
    e('staff', 'delivery', 'accept and send'),
  ],
}

// ---------------------------------------------------------------- guest channel

const guest: MapTab = {
  id: 'guest',
  label: 'Guest channel',
  blurb:
    'The chat bubble is the product surface. Everything the agent does is shown to the guest as it happens, which is also what makes it auditable.',
  nodes: [
    n('landing', 0, 140, {
      layer: 'guest',
      provider: 'Netlify',
      title: 'Landing page',
      detail: 'Typography-driven, no stock photography, support number displayed.',
      why: 'A generic-but-real hotel reads as white-label. A branded one reads as a mockup.',
      status: 'live',
    }),
    n('bubble', 400, 140, {
      layer: 'guest',
      provider: 'React',
      title: 'Chat bubble',
      detail: 'Bottom-right. Greeting: “Hi, I’m Sol, I’m here to help with anything you need.”',
      why: 'Same persona and greeting as the phone line, so the guest meets one assistant, not two.',
      status: 'live',
    }),
    n('chatapi', 800, 20, {
      layer: 'runtime',
      provider: 'Netlify Functions',
      title: '/api/chat',
      detail: 'Holds the Anthropic key, runs the tool loop, writes every turn to Postgres.',
      why: 'The API key must never reach the browser, and the transcript must exist even if the tab closes.',
      status: 'live',
    }),
    n('claude', 1200, 20, {
      layer: 'runtime',
      provider: 'Anthropic',
      title: 'Claude',
      detail: 'Persona and guardrails compiled from agent/sol.md; tools from shared/toolContracts.ts.',
      why: 'Chat has a looser latency budget than voice, so we spend it on tool use and citations.',
      status: 'live',
    }),
    n('tools', 1200, 320, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'Tool layer',
      detail: 'identify_guest, get_reservation, get_policy, check_late_checkout, create_escalation…',
      why: 'Every answer with a fact in it comes from here, so “never invent hotel facts” is structural.',
      status: 'live',
    }),
    n('chips', 800, 320, {
      layer: 'guest',
      provider: 'React',
      title: 'Tool chips + citations',
      detail: '“checking your reservation”, “reading the cancellation policy”, rendered inline as they fire.',
      why: 'The guest sees work happening and the panel sees the agent is not a black box. Same component, two audiences.',
      status: 'live',
    }),
    n('messages', 1600, 140, {
      layer: 'data',
      provider: 'Supabase',
      title: 'messages + tool_invocations',
      detail: 'Written per turn and per tool call, with arguments masked before insert.',
      why: 'Masking in the data layer means no prompt and no log can leak a card number by accident.',
      status: 'live',
    }),
    n('supervisor', 1600, 420, {
      layer: 'staff',
      provider: 'Supabase Realtime',
      title: 'Supervisor view',
      detail: 'The same rows stream to /admin/sessions/:id within about a second.',
      why: 'One transcript path. The archive can never disagree with what the supervisor watched.',
      status: 'live',
    }),
  ],
  edges: [
    e('landing', 'bubble', 'mounts'),
    e('bubble', 'chatapi', 'POST, SSE back', true),
    e('chatapi', 'claude', 'messages API', true),
    e('claude', 'tools', 'tool_use'),
    e('tools', 'chips', 'trace'),
    e('chatapi', 'messages', 'insert', true),
    e('tools', 'messages', 'insert'),
    e('messages', 'supervisor', 'realtime', true),
  ],
}

// ---------------------------------------------------------------- voice

const voice: MapTab = {
  id: 'voice',
  label: 'Voice',
  blurb:
    'Live transcripts and human takeover are both assembled from documented Telnyx Call Control primitives. There is no vendor “supervisor button”; there are four rungs we build.',
  nodes: [
    n('caller', 0, 180, {
      layer: 'guest',
      provider: 'PSTN',
      title: 'Guest calls the number',
      detail: 'Caller ID becomes the identity hint; no confirmation number required to start.',
      status: 'live',
    }),
    n('did', 380, 180, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'Phone number + Call Control',
      detail: 'The DID attached to the assistant. Every leg is an ordinary Call Control leg.',
      why: 'Because it is ordinary Call Control, supervision primitives apply to it too.',
      status: 'live',
    }),
    n('assistant', 760, 180, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'AI Assistant “Sol”',
      detail: 'Started with ai_assistant_start and send_message_history_updates: true.',
      why: 'Telnyx owns turn-taking and barge-in. Rebuilding that is the classic FDE trap.',
      status: 'live',
    }),
    n('webhooktools', 1140, 20, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'Assistant webhook tools',
      detail: 'The same endpoints the chat runtime calls, registered as assistant tools.',
      why: 'If voice had its own tools, voice and chat would answer the same policy question differently within a month.',
      status: 'live',
    }),
    n('historyevt', 1140, 320, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'call.ai_gather.message_history_updated',
      detail: 'Fires once per conversation turn with cumulative history.',
      why: 'Turn-level is enough for a supervisor. Word-level interim would need a concurrent transcription we do not need.',
      status: 'live',
    }),
    n('eventfn', 1540, 320, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: '/api/telnyx/events',
      detail: 'Verifies the signature, diffs the history, inserts only new turns.',
      why: 'The event carries the whole history each time; inserting it naively would duplicate the transcript.',
      status: 'live',
    }),
    n('messages', 1920, 320, {
      layer: 'data',
      provider: 'Supabase',
      title: 'messages',
      detail: 'One row per turn, role user or assistant, plus supervisor rows on takeover.',
      status: 'live',
    }),
    n('supui', 1920, 600, {
      layer: 'staff',
      provider: 'React',
      title: 'Supervisor dashboard',
      detail: 'Live grid, live transcript, live tool trace, and the control ladder.',
      status: 'live',
    }),
    n('ladderapi', 1140, 620, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'POST /api/voice/supervisor',
      detail: '{ session_id, action: listen | whisper | barge | takeover }. Owns the Telnyx key and the leg bookkeeping.',
      why: 'The browser must never hold a Telnyx API key, and rung state belongs next to the call, not in a tab.',
      status: 'live',
    }),
    n('supleg', 760, 620, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'Supervisor leg',
      detail: 'POST /v2/calls with supervise_call_control_id and supervisor_role; escalated via switch_supervisor_role. Verified on a live call: the supervisor hears the GUEST, not Sol, because an assistant leg injects its own audio rather than streaming it. The transcript carries both sides regardless.',
      why: 'Monitor, whisper and barge are one parameter apart, so the ladder is a role change, not three integrations.',
      status: 'live',
    }),
    n('webrtc', 380, 620, {
      layer: 'staff',
      provider: '@telnyx/webrtc',
      title: 'Supervisor joins from the browser',
      detail: 'Credential SIP connection, registered as supervisor@sip.telnyx.com.',
      why: 'A supervisor on a laptop should not need a desk phone to take a call.',
      status: 'live',
    }),
    n('stop', 760, 900, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'ai_assistant_stop',
      detail: 'Sol goes silent. Telnyx documents that the call remains active and keeps accepting commands.',
      why: 'This is the whole takeover. The guest is never dropped and never re-dialled.',
      status: 'live',
    }),
  ],
  edges: [
    e('caller', 'did', 'dials', true),
    e('did', 'assistant', 'ai_assistant_start'),
    e('assistant', 'webhooktools', 'tool calls'),
    e('assistant', 'historyevt', 'per turn', true),
    e('historyevt', 'eventfn', 'webhook', true),
    e('eventfn', 'messages', 'insert new turns', true),
    e('messages', 'supui', 'realtime', true),
    e('supui', 'ladderapi', 'rung clicked'),
    e('ladderapi', 'supleg', 'create / switch role'),
    e('webrtc', 'supleg', 'SIP URI'),
    e('supleg', 'assistant', 'supervises'),
    e('ladderapi', 'stop', 'takeover'),
    e('stop', 'assistant', 'silences'),
  ],
}

// ---------------------------------------------------------------- agent + tools

const agent: MapTab = {
  id: 'agent',
  label: 'Agent and tools',
  blurb:
    'One agent definition, two runtimes, one tool layer. Voice and chat have different latency budgets, so they run on different engines, but they cannot disagree about policy.',
  nodes: [
    n('soldef', 0, 240, {
      layer: 'tools',
      provider: 'In repo',
      title: 'agent/sol.md',
      detail: 'Persona, greeting, guardrails, routing and tool contracts. The single definition.',
      why: 'Two prompt files means two agents within a week. One file compiles to both runtimes.',
      status: 'live',
    }),
    n('telnyxcfg', 400, 60, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'Assistant config (JSON)',
      detail: 'Exported natively from the platform and shipped as a deliverable.',
      status: 'live',
    }),
    n('claudeprompt', 400, 420, {
      layer: 'runtime',
      provider: 'Anthropic',
      title: 'Claude system prompt',
      detail: 'Same persona, same guardrails, different latency budget.',
      status: 'live',
    }),
    n('contracts', 800, 240, {
      layer: 'tools',
      provider: 'In repo',
      title: 'shared/toolContracts.ts',
      detail: 'Tool names and argument shapes. Both runtimes are generated from it.',
      why: 'TypeScript is the guarantee that a renamed tool breaks the build instead of breaking a call.',
      status: 'live',
    }),
    n('concierge', 1200, 0, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'Concierge tools',
      detail: 'identify_guest, get_reservation, get_policy, check_late_checkout, check_upgrade_eligibility, check_comp_authority, create_escalation, transfer_to_human.',
      status: 'live',
    }),
    n('group', 1200, 300, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'Group tools',
      detail: 'parse_inquiry, validate_property_data, check_availability, evaluate_group_rules, price_block, generate_proposal, send_proposal.',
      status: 'live',
    }),
    n('availability', 1200, 620, {
      layer: 'tools',
      provider: 'Net-new',
      title: 'availability.ts — sameDayAvailability()',
      detail: 'The provided exports have no inventory by date. Without this tool the agent would have to invent availability.',
      why: 'This is the net-new tool the brief asked for, and it exists because the data gap was real, not decorative.',
      status: 'live',
    }),
    n('envelope', 1620, 120, {
      layer: 'data',
      provider: 'In repo',
      title: 'ToolResult envelope',
      detail: 'ok, data, grounded, citations, masked_fields, latency_ms. Every tool, no exceptions.',
      why: 'grounded:false is a machine-checkable instruction to escalate. “Be careful” in a prompt is not.',
      status: 'live',
    }),
    n('escalation', 1620, 440, {
      layer: 'data',
      provider: 'Supabase',
      title: 'escalations',
      detail: 'Category, severity, policy citations, attempted resolutions, recommended action, authority required.',
      why: 'A handoff without a context packet just moves the guest’s frustration to a human.',
      status: 'live',
    }),
  ],
  edges: [
    e('soldef', 'telnyxcfg', 'compiles to'),
    e('soldef', 'claudeprompt', 'compiles to'),
    e('telnyxcfg', 'contracts', 'tool names'),
    e('claudeprompt', 'contracts', 'tool names'),
    e('contracts', 'concierge'),
    e('contracts', 'group'),
    e('contracts', 'availability'),
    e('concierge', 'envelope', 'returns'),
    e('group', 'envelope', 'returns'),
    e('availability', 'envelope', 'returns'),
    e('envelope', 'escalation', 'grounded:false'),
  ],
}

// ---------------------------------------------------------------- data

const data: MapTab = {
  id: 'data',
  label: 'Data',
  blurb:
    'Four provided files, two deliberate landmines, and a scoping model that lives in Postgres rather than in a component.',
  nodes: [
    n('csvs', 0, 240, {
      layer: 'data',
      provider: 'Provided',
      title: 'data/*.csv + policy reference',
      detail: 'Properties, guest profiles, reservations, and the front desk policy markdown.',
      status: 'live',
    }),
    n('seed', 400, 240, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Seeder (service role)',
      detail: 'Parses the exports, extracts rules buried in free-text notes, writes reference tables.',
      why: 'Seasonal caps hide in a notes column. Parsing them at build time beats hoping the model notices at runtime.',
      status: 'live',
    }),
    n('quarantine', 400, 560, {
      layer: 'data',
      provider: 'In repo',
      title: 'Data quality quarantine',
      detail: 'SOL-PVD base_rate_suite is −395. It is flagged and excluded, never priced from.',
      why: 'A negative rate is the kind of thing that quietly produces a refund. Quarantine is cheaper than an apology.',
      status: 'live',
    }),
    n('ref', 840, 0, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Reference tables',
      detail: 'properties, guests, reservations, policies. Readable by any signed-in staff account.',
      status: 'live',
    }),
    n('conv', 840, 280, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Conversation tables',
      detail: 'sessions, messages, tool_invocations, escalations.',
      status: 'live',
    }),
    n('groupt', 840, 560, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Group tables',
      detail: 'inquiries, proposals, audit_log.',
      status: 'live',
    }),
    n('rls', 1280, 140, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Row level security',
      detail: 'my_role() is a security-definer function; policies grant conversations to concierge and inquiries to group sales.',
      why: 'Ask “how do you know a sales rep cannot read guest calls” and the answer is a policy you can read, not a code review.',
      status: 'live',
    }),
    n('realtime', 1280, 440, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Realtime publication',
      detail: 'sessions, messages, tool_invocations, escalations, inquiries, proposals.',
      status: 'live',
    }),
    n('storage', 1280, 720, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Storage',
      detail: 'Proposal PDFs, served as time-limited signed URLs.',
      status: 'live',
    }),
    n('pvd', 840, 840, {
      layer: 'tools',
      provider: 'Provided data',
      title: 'The Providence referral',
      detail: 'SOL-PVD notes route blocks over 15 rooms to a Boston-area sister property that is not in the directory.',
      why: 'We surface the referral and refuse to quote inventory we cannot see. Inventing the sister property is the failure mode.',
      status: 'live',
    }),
  ],
  edges: [
    e('csvs', 'seed', 'parse'),
    e('seed', 'ref', 'write'),
    e('seed', 'quarantine', 'validate'),
    e('seed', 'pvd', 'extract note'),
    e('ref', 'rls'),
    e('conv', 'rls'),
    e('groupt', 'rls'),
    e('conv', 'realtime'),
    e('groupt', 'realtime'),
    e('groupt', 'storage', 'pdf_path'),
  ],
}

// ---------------------------------------------------------------- delivery

const delivery: MapTab = {
  id: 'delivery',
  label: 'Delivery',
  blurb:
    'Delivery is a channel adapter, not an integration. The proposal does not know or care how it reaches the customer, which is also the honest answer to “what happens when a provider fails”.',
  nodes: [
    n('sendtool', 0, 260, {
      layer: 'tools',
      provider: 'Netlify Functions',
      title: 'send_proposal(proposal_id)',
      detail: 'Called from the group sales UI, or by the agent once a human has approved.',
      status: 'live',
    }),
    n('adapter', 400, 260, {
      layer: 'delivery',
      provider: 'In repo',
      title: 'Channel adapter',
      detail: 'Email if there is an address; SMS if only a number; flag for a human if neither.',
      why: 'Changing channel, or changing provider, is config. Nothing above this line moves when the provider below it does, which is also the honest answer to what happens when one fails.',
      status: 'live',
    }),
    n('pdf', 400, 580, {
      layer: 'delivery',
      provider: 'pdf-lib',
      title: 'PDF generation',
      detail: 'Rendered server-side, stored in Supabase Storage, referenced by signed URL.',
      why: 'Generating in the function keeps the branded artifact identical on both channels.',
      status: 'live',
    }),
    n('email', 840, 40, {
      layer: 'delivery',
      provider: 'Telnyx',
      title: 'Email API',
      detail: 'Branded HTML email with the PDF attached. GA since August 2026.',
      why: 'One provider, one key and one bill across voice, SMS and email. A dedicated email vendor was evaluated and dropped: it adds a vendor for a nervous IT team to approve without adding a capability.',
      status: 'live',
    }),
    n('sms', 840, 320, {
      layer: 'delivery',
      provider: 'Telnyx',
      title: 'SMS (10DLC)',
      detail: 'Short message plus an https link to the hosted PDF.',
      why: 'PDF over MMS has limited carrier support. A link always arrives; an attachment sometimes does not.',
      status: 'blocked',
    }),
    n('storage', 840, 600, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Signed URL',
      detail: 'Time-limited link to the stored PDF, used by both channels.',
      status: 'live',
    }),
    n('carrier', 1280, 320, {
      layer: 'delivery',
      provider: 'Carriers',
      title: '10DLC registration',
      detail: 'Unregistered traffic has been blocked outright since February 2025. No demo or pilot exemption exists.',
      why: 'This is upstream of Telnyx, so no vendor choice fixes it. Email is the default at submission; SMS switches on if registration clears before the panel.',
      status: 'blocked',
    }),
    n('audit', 1280, 600, {
      layer: 'data',
      provider: 'Supabase',
      title: 'audit_log',
      detail: 'Who approved, overrode, sent or rejected what, with the justification they typed.',
      why: 'An override without a recorded reason is indistinguishable from a mistake.',
      status: 'live',
    }),
  ],
  edges: [
    e('sendtool', 'adapter', 'proposal_id'),
    e('adapter', 'email', 'email present'),
    e('adapter', 'sms', 'phone only'),
    e('adapter', 'pdf', 'render'),
    e('pdf', 'storage', 'store'),
    e('storage', 'sms', 'link'),
    e('storage', 'email', 'attach'),
    e('sms', 'carrier', 'gated by'),
    e('adapter', 'audit', 'record'),
  ],
}

// ---------------------------------------------------------------- deploy

const deploy: MapTab = {
  id: 'deploy',
  label: 'Deploy',
  blurb:
    'One repository, one build, one deployed application, and a hard line about which secrets are allowed to cross into the browser.',
  nodes: [
    n('repo', 0, 220, {
      layer: 'deploy',
      provider: 'GitHub',
      title: 'Repository',
      detail: 'App, serverless functions, schema, agent definition and plans in one place.',
      why: 'The agent definition living beside the code is what makes “open the hood live” possible.',
      status: 'live',
    }),
    n('build', 400, 220, {
      layer: 'deploy',
      provider: 'Netlify',
      title: 'Build',
      detail: 'vite build to dist, esbuild bundling for netlify/functions.',
      status: 'live',
    }),
    n('cdn', 840, 60, {
      layer: 'deploy',
      provider: 'Netlify',
      title: 'CDN + SPA redirect',
      detail: 'Static assets, /* rewritten to index.html so deep links into /admin work.',
      status: 'live',
    }),
    n('funcs', 840, 340, {
      layer: 'deploy',
      provider: 'Netlify',
      title: 'Functions at /api/*',
      detail: '/api/* is redirected to /.netlify/functions/*, so the browser never sees the vendor path.',
      why: 'Same origin means no CORS, no preflight, and no second domain to explain.',
      status: 'live',
    }),
    n('secrets', 400, 560, {
      layer: 'deploy',
      provider: 'Netlify env',
      title: 'Secret boundary',
      detail: 'Only SUPABASE_URL and the anon key are exposed to the bundle. Service role, Telnyx and Anthropic keys stay server-side.',
      why: 'The anon key is safe precisely because RLS is real. That is the same claim, checked twice.',
      status: 'live',
    }),
    n('supabase', 1280, 200, {
      layer: 'data',
      provider: 'Supabase',
      title: 'Project',
      detail: 'Postgres, Auth, Realtime and Storage in one managed project, us-east.',
      why: 'Firebase would have meant giving up SQL and row level security, which are the two things the scoping story rests on.',
      status: 'live',
    }),
    n('telnyx', 1280, 500, {
      layer: 'runtime',
      provider: 'Telnyx',
      title: 'Mission Control',
      detail: 'Number, AI Assistant, SIP credential connection, messaging profile, email domain.',
      why: 'Twilio plus SendGrid plus a voice-agent vendor is three bills and three failure modes.',
      status: 'live',
    }),
    n('anthropic', 1280, 760, {
      layer: 'runtime',
      provider: 'Anthropic',
      title: 'API key',
      detail: 'Server-side only, used by /api/chat and the group side chat.',
      status: 'live',
    }),
  ],
  edges: [
    e('repo', 'build', 'push'),
    e('build', 'cdn', 'dist'),
    e('build', 'funcs', 'bundle'),
    e('secrets', 'build', 'injected'),
    e('funcs', 'supabase', 'service role'),
    e('cdn', 'supabase', 'anon key + RLS'),
    e('funcs', 'telnyx', 'API key'),
    e('funcs', 'anthropic', 'API key'),
  ],
}

export const MAP_TABS: MapTab[] = [overview, guest, voice, agent, data, delivery, deploy]
