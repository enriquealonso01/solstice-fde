/**
 * Guest-facing wording for each tool.
 *
 * The server sends a `summary` and that always wins: the agent knows which
 * reservation or which property it is touching, and we would rather show
 * "checking your reservation in Denver" than a generic phrase. This map is the
 * floor, for the case where `summary` is empty.
 *
 * Keyed by `ToolName` from shared/toolContracts so a rename over there shows up
 * here as a type error rather than as a chip reading `check_late_checkout`.
 */
import type { ToolName } from '../../../shared/toolContracts'

const TOOL_LABELS: Partial<Record<ToolName, string>> = {
  // concierge
  identify_guest: 'finding your profile',
  get_reservation: 'checking your reservation',
  get_policy: 'reading the policy reference',
  check_late_checkout: 'checking late check-out',
  check_upgrade_eligibility: 'checking upgrade eligibility',
  book_amenity: 'booking that for you',
  check_service_recovery_eligibility: 'reviewing service recovery',
  check_comp_authority: 'checking approval authority',
  get_property_info: 'pulling up the property',
  create_escalation: 'writing this up for a manager',
  transfer_to_human: 'connecting you to the team',

  // group
  parse_inquiry: 'reading the details you gave me',
  validate_property_data: 'validating the property data',
  check_availability: 'checking availability',
  evaluate_group_rules: 'applying the group booking rules',
  price_block: 'pricing the block',
  find_alternates: 'looking at alternatives',
  draft_clarifying_questions: 'noting what is still missing',
  generate_proposal: 'drafting the proposal',
  submit_for_approval: 'sending it for approval',
  send_proposal: 'sending the proposal',
  create_inquiry: 'logging this for group sales',

  // routing
  classify_intent: 'understanding your request',
}

export function toolLabel(name: string, summary?: string): string {
  const trimmed = summary?.trim()
  if (trimmed) return trimmed

  const known = TOOL_LABELS[name as ToolName]
  if (known) return known

  // An unknown tool still has to read as an action, not as an identifier.
  return name.replace(/_/g, ' ').trim() || 'working on it'
}
