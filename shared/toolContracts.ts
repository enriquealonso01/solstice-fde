// The single source of truth for tool names and argument shapes.
// The Telnyx assistant config and the Claude chat runtime are both generated from this,
// which is what guarantees voice and chat cannot drift apart.

export const CONCIERGE_TOOLS = [
  'identify_guest',
  'get_reservation',
  'get_policy',
  'check_late_checkout',
  'check_upgrade_eligibility',
  'book_amenity',
  'check_service_recovery_eligibility',
  'check_comp_authority',
  'get_property_info',
  'create_escalation',
  'transfer_to_human',
] as const

export const GROUP_TOOLS = [
  'parse_inquiry',
  'validate_property_data',
  'check_availability',
  'evaluate_group_rules',
  'price_block',
  'find_alternates',
  'draft_clarifying_questions',
  'generate_proposal',
  'submit_for_approval',
  'send_proposal',
  'create_inquiry',
  'update_inquiry',
] as const

export const ROUTING_TOOLS = ['classify_intent'] as const

export type ConciergeTool = (typeof CONCIERGE_TOOLS)[number]
export type GroupTool = (typeof GROUP_TOOLS)[number]
export type ToolName = ConciergeTool | GroupTool | (typeof ROUTING_TOOLS)[number]

export interface ToolSpec {
  name: ToolName
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean }>
}
