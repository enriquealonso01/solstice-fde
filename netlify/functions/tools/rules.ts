/**
 * BUSINESS RULES AS DATA.
 *
 * Every threshold, window, entitlement and escalation route the concierge agent
 * relies on lives in this file as a plain value. Nothing here is prose inside a
 * prompt, because the panel will ask us to change a rule live and that must be a
 * one-line edit that takes effect on the next tool call.
 *
 * Source of truth: `data/SOLSTICE HOTEL GROUP - FRONT DESK POLICY REFERENCE.md`
 * and `data/solstice-properties.csv`. Each entry names the policy section it
 * encodes so a non-engineer can audit it against the printed policy.
 *
 * Currency is integer cents everywhere arithmetic happens.
 */
import type { LoyaltyTier } from '../../../shared/types'

// ---------------------------------------------------------------- live knobs

/** The numbers most likely to be changed on stage. One line each, on purpose. */
export const POLICY_RULES = {
  /** Policy 1 */ standard_check_in_local: '15:00',
  /** Policy 1 */ standard_check_out_local: '11:00',
  /** Policy 2 */ free_cancellation_window_hours: 72,
  /** Policy 2 */ late_cancellation_penalty: 'one night room and tax, charged to the card on file',
  /** Policy 4 */ no_show_cutoff_local: '23:59',
  /** Policy 5 */ service_recovery_window_hours: 72,
  /** Policy 7 */ front_desk_comp_authority_cents: 5000,
  /** Policy 9 */ standard_room_occupancy: 2,
  /** Policy 9 */ suite_occupancy: 4,
  /** Policy 9 */ rollaway_free_child_age_under: 12,
  /** Policy 10 */ smoking_cleaning_fee_max_cents: 25000,
  /** Policy 11 */ lost_and_found_hold_days: 90,
  /** Policy 14 */ incidental_hold_per_night_cents: 5000,
  /** Policy 14 */ cash_deposit_nightly_rate_multiple: 2,
  /**
   * Same-day occupancy above which a DISCRETIONARY late checkout (Policy 1, and
   * the Gold 1PM benefit in Policy 6) is declined. Platinum's 2PM is guaranteed
   * and is never gated on this number.
   */
  discretionary_late_checkout_max_occupancy: 0.9,
  /** Same-day occupancy above which a discretionary early check-in is declined (Policy 1). */
  discretionary_early_check_in_max_occupancy: 0.85,
} as const

// ------------------------------------------------------- Policy 6: tier benefits

export type UpgradeEntitlement = 'none' | 'next_class_if_available' | 'next_class_guaranteed'

export interface TierBenefit {
  upgrade: UpgradeEntitlement
  /** Latest checkout the tier is entitled to, local time. `null` = no entitlement. */
  late_checkout_local: string | null
  /** True only where the policy uses the word "guaranteed". */
  guaranteed: boolean
  human_summary: string
}

export const TIER_BENEFITS: Record<LoyaltyTier, TierBenefit> = {
  None: {
    upgrade: 'none',
    late_checkout_local: null,
    guaranteed: false,
    human_summary: 'No tier entitlement. Late checkout and upgrades are front-desk discretion, same-day availability only.',
  },
  Silver: {
    upgrade: 'none',
    late_checkout_local: null,
    guaranteed: false,
    human_summary: 'Silver earns points but has no automatic check-in perk. Late checkout and upgrades stay discretionary.',
  },
  Gold: {
    upgrade: 'next_class_if_available',
    late_checkout_local: '13:00',
    guaranteed: false,
    human_summary: 'Gold gets a complimentary upgrade at check-in when one is available, plus late checkout to 1:00 PM subject to availability.',
  },
  Platinum: {
    upgrade: 'next_class_guaranteed',
    late_checkout_local: '14:00',
    guaranteed: true,
    human_summary: 'Platinum gets a guaranteed upgrade to the next room class against same-day inventory, and a guaranteed 2:00 PM checkout with no blackout dates and no exceptions.',
  },
}

/**
 * Room-class ladder used for "next room class" upgrades (Policy 6).
 * Accessible rooms are deliberately NOT on the ladder: moving a guest out of an
 * accessible room is an accessibility decision, not an upgrade, so those go to a
 * human. Stated as an assumption in agent/sol.md.
 */
export const ROOM_CLASS_LADDER = ['Standard Double', 'Standard King', 'Deluxe King', 'Suite'] as const
export type RoomClass = (typeof ROOM_CLASS_LADDER)[number]

export const ACCESSIBLE_ROOM_TYPES = ['Accessible King', 'Accessible Double'] as const

// ---------------------------------------- Policy 2 / 3 / 4: refundability by rate plan

export type RefundClass = 'free_cancellation_window' | 'non_refundable' | 'not_documented'

export interface RatePlanTerms {
  refund_class: RefundClass
  policy_ref: number | null
  human_summary: string
  /** What the agent may honestly offer when the guest pushes. */
  recourse: string | null
}

export const RATE_PLAN_TERMS: Record<string, RatePlanTerms> = {
  'Best Available Rate': {
    refund_class: 'free_cancellation_window',
    policy_ref: 2,
    human_summary:
      'Free cancellation up to 72 hours before check-in. Inside 72 hours the guest forfeits one night room and tax, charged to the card on file.',
    recourse: null,
  },
  'Corporate Negotiated': {
    refund_class: 'free_cancellation_window',
    policy_ref: 2,
    human_summary:
      'Free cancellation up to 72 hours before check-in. Inside 72 hours the guest forfeits one night room and tax, charged to the card on file.',
    recourse: null,
  },
  'Advance Purchase': {
    refund_class: 'non_refundable',
    policy_ref: 3,
    human_summary:
      'Non-refundable and non-changeable from the moment it is booked. This holds for weather, flight cancellations and illness. The front desk has no authority to waive it, and there is no exception process.',
    recourse: 'Travel insurance, if the guest purchased it, is the only real recourse.',
  },
  'Loyalty Redemption': {
    // DELIBERATE GAP. Policy 2 names Best Available Rate and Corporate Negotiated.
    // Policy 3 covers Advance Purchase. No section covers points redemptions, so
    // the agent must not extrapolate: it says so and escalates.
    refund_class: 'not_documented',
    policy_ref: null,
    human_summary:
      'No written policy covers cancellation or refund of a Loyalty Redemption booking. Do not extrapolate from the cash rate plans. Confirm with the property team.',
    recourse: null,
  },
}

// ------------------------------------------------- Policy 5: service recovery window

export const SERVICE_RECOVERY = {
  window_hours: POLICY_RULES.service_recovery_window_hours,
  /**
   * The wrinkle, encoded rather than hoped for: a complaint raised DURING the
   * stay counts as the complaint having been made. The 72-hour clock is anchored
   * to checkout either way, and a later follow-up asking what we will do about it
   * does not restart it and does not forfeit it.
   */
  in_stay_complaint_counts: true,
  inside_window_remedies: ['refund', 'credit', 'comp night'],
  outside_window_remedies: ['loyalty points as a goodwill gesture'],
  outside_window_forbidden: ['refund', 'comp night'],
  /** Policy 15: a refund request outside the window is above front-desk authority. */
  outside_window_escalation_category: 'refund' as const,
} as const

// ----------------------------------------------------- Policy 7: comp authority

export const COMP_AUTHORITY = {
  front_desk_max_cents: POLICY_RULES.front_desk_comp_authority_cents,
  /** Multiple small issues in one stay are SUMMED before deciding authority. */
  aggregate_per_stay: true,
  /** A full comped night always needs AGM or GM sign-off, whatever the amount. */
  comp_night_always_escalates: true,
  examples_within_authority: ['waived resort fee', 'minibar item', 'parking charge'],
} as const

// ------------------------------------------------------- Policy 8: animals

export const ANIMAL_RULES = {
  pets_permitted: false,
  pet_friendly_floors: false,
  service_animals_permitted: true,
  service_animal_fee_cents: 0,
  may_ask: ['what task the animal is trained to perform'],
  may_not_ask: ['certification', 'documentation', 'a demonstration'],
  may_not_charge_pet_fee_for_service_animal: true,
} as const

// ------------------------------------------------ Policy 12: parking (the refusal)

export const PARKING_RULES = {
  /**
   * There is NO chain-wide parking rate. `get_property_info` must refuse to quote
   * a number, and no property record in the provided data carries one. The refusal
   * IS the grounded answer; it is not a failure.
   */
  chain_wide_rate_exists: false,
  varies_by_property: true,
  known_arrangements: ['free self-parking', 'nightly charge', 'valet only'],
  guidance:
    'Parking availability and price vary by property. We do not carry a chain-wide rate, so the current rate comes from the property fact sheet or the on-site front desk team.',
} as const

// ----------------------------------------------------- Policy 15: escalation matrix

export type EscalationCategory =
  | 'refund'
  | 'dispute'
  | 'medical'
  | 'legal'
  | 'safety'
  | 'authority_exceeded'
  | 'other'

export type Authority = 'front_desk' | 'agm' | 'gm' | 'regional_security'

export interface EscalationRoute {
  authority: Authority
  severity: 'low' | 'normal' | 'high' | 'critical'
  /** Same day (Policy 15 default) vs immediately, any hour. */
  timing: 'same_day' | 'immediate_any_hour'
  notify: string[]
  /** True where Policy 15 does not name the case and we mapped it. Audit this. */
  mapped_assumption: boolean
  human_reason: string
}

export const ESCALATION_MATRIX: Record<EscalationCategory, EscalationRoute> = {
  safety: {
    authority: 'regional_security',
    severity: 'critical',
    timing: 'immediate_any_hour',
    notify: ['General Manager', 'Regional Security'],
    mapped_assumption: false,
    human_reason:
      'Policy 15: anything involving guest safety, a threat, or law enforcement goes straight to the General Manager and Regional Security, any hour, no exceptions, without waiting for a manager to be on-site.',
  },
  medical: {
    authority: 'gm',
    severity: 'high',
    timing: 'immediate_any_hour',
    notify: ['General Manager', 'Regional Security'],
    mapped_assumption: true,
    human_reason:
      'Policy 15 does not name medical events. We map them to the guest-safety row because a medical emergency is a guest-safety event. Emergency services come first, the escalation second.',
  },
  legal: {
    authority: 'gm',
    severity: 'high',
    timing: 'same_day',
    notify: ['General Manager'],
    mapped_assumption: true,
    human_reason:
      'Policy 15 does not name legal threats. We route them above front-desk authority to the GM, same day, on the same logic as a dispute that is escalating.',
  },
  refund: {
    authority: 'agm',
    severity: 'normal',
    timing: 'same_day',
    notify: ['Manager on duty', 'AGM'],
    mapped_assumption: false,
    human_reason:
      'Policy 15: refund requests outside the service recovery window go to the Manager on duty or the AGM the same day.',
  },
  dispute: {
    authority: 'agm',
    severity: 'normal',
    timing: 'same_day',
    notify: ['Manager on duty', 'AGM'],
    mapped_assumption: false,
    human_reason:
      'Policy 15: a guest dispute that is getting heated goes to the Manager on duty or the AGM the same day.',
  },
  authority_exceeded: {
    authority: 'agm',
    severity: 'normal',
    timing: 'same_day',
    notify: ['Manager on duty', 'AGM'],
    mapped_assumption: false,
    human_reason:
      'Policy 7 and Policy 15: comps over $50, or a full comped night, need AGM or GM sign-off the same day.',
  },
  other: {
    authority: 'agm',
    severity: 'normal',
    timing: 'same_day',
    notify: ['Manager on duty', 'AGM'],
    mapped_assumption: false,
    human_reason:
      'Policy 15: anything outside your own authority goes to the Manager on duty or the AGM the same day.',
  },
}

/**
 * Plain-language triggers a non-engineer can audit, mapped to the matrix rows
 * above. `create_escalation` uses these when the caller does not name a category.
 */
export const ESCALATION_TRIGGERS: Array<{ match: string[]; category: EscalationCategory }> = [
  { match: ['threat', 'weapon', 'assault', 'violence', 'police', 'law enforcement', 'unsafe', 'intruder', 'harass'], category: 'safety' },
  { match: ['ambulance', 'injury', 'injured', 'chest pain', 'unconscious', 'allergic reaction', 'medical', 'paramedic'], category: 'medical' },
  { match: ['lawyer', 'attorney', 'sue', 'lawsuit', 'legal action', 'liability claim'], category: 'legal' },
  { match: ['refund', 'money back', 'chargeback', 'reverse the charge'], category: 'refund' },
  { match: ['dispute', 'furious', 'unacceptable', 'complaint', 'escalate', 'manager now'], category: 'dispute' },
  { match: ['media', 'journalist', 'press', 'reporter'], category: 'dispute' },
  { match: ['vip', 'notify gm on arrival'], category: 'other' },
  { match: ['comp', 'waive', 'credit'], category: 'authority_exceeded' },
]

// ------------------------------------------------------- Policy 13: group blocks

export const GROUP_BLOCK_RULES = {
  /**
   * Policy 13. The concierge agent NEVER approves, modifies, prices or discounts a
   * group block. Group intent is a routing decision, not a concierge decision.
   */
  front_desk_may_approve: false,
  front_desk_may_modify: false,
  front_desk_may_discount: false,
  authority: 'Sales and the General Manager',
  concierge_action: 'route to the group booking flow and capture the inquiry',
  /**
   * Rooms at or above this count are treated as a group block rather than an
   * ordinary booking question. No policy defines the line, so this is our knob:
   * the smallest inquiry in the provided export is 12 rooms, and 5 keeps a family
   * booking two rooms out of the sales queue. One number, one place, editable live.
   */
  group_intent_room_threshold: 5,
} as const

// ------------------------------------------------------------- amenity catalog

export interface AmenityDefinition {
  id: string
  label: string
  chargeable: boolean
  /**
   * `null` means a fee applies but the amount is NOT in any provided data.
   * The agent must say a fee applies without quoting a number.
   */
  price_cents: number | null
  /** Zero-cost standard services the agent may confirm outright. */
  confirmable_by_agent: boolean
  /** Depends on same-day inventory, so it is a request, never a promise. */
  inventory_dependent: boolean
  policy_refs: number[]
  note: string
}

export const AMENITY_CATALOG: Record<string, AmenityDefinition> = {
  turndown_note: {
    id: 'turndown_note',
    label: 'Turndown service with a celebration note',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: true,
    inventory_dependent: false,
    policy_refs: [],
    note: 'Zero-cost standard service the property can accommodate.',
  },
  hypoallergenic_bedding: {
    id: 'hypoallergenic_bedding',
    label: 'Hypoallergenic bedding',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: true,
    inventory_dependent: false,
    policy_refs: [],
    note: 'Housekeeping request, no charge.',
  },
  extra_pillows: {
    id: 'extra_pillows',
    label: 'Extra pillows or blankets',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: true,
    inventory_dependent: false,
    policy_refs: [],
    note: 'Housekeeping request, no charge.',
  },
  wake_up_call: {
    id: 'wake_up_call',
    label: 'Wake-up call',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: true,
    inventory_dependent: false,
    policy_refs: [],
    note: 'Front desk service, no charge.',
  },
  ground_floor_room: {
    id: 'ground_floor_room',
    label: 'Ground-floor room request',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: false,
    inventory_dependent: true,
    policy_refs: [1],
    note: 'Subject to same-day availability. Requested, never guaranteed.',
  },
  connecting_rooms: {
    id: 'connecting_rooms',
    label: 'Connecting rooms',
    chargeable: false,
    price_cents: 0,
    confirmable_by_agent: false,
    inventory_dependent: true,
    policy_refs: [1],
    note: 'Limited inventory. Confirm with the property before promising.',
  },
  rollaway_bed: {
    id: 'rollaway_bed',
    label: 'Rollaway bed',
    chargeable: true,
    price_cents: null,
    confirmable_by_agent: false,
    inventory_dependent: true,
    policy_refs: [9],
    note:
      'Nightly fee applies; the amount is not in the chain data, so never quote one. Subject to the room fire-code maximum occupancy, which the property system flags. Children under 12 on an existing bed setup do not count toward the fee.',
  },
  celebration_amenity: {
    id: 'celebration_amenity',
    label: 'Champagne or celebration amenity',
    chargeable: true,
    price_cents: null,
    confirmable_by_agent: false,
    inventory_dependent: false,
    policy_refs: [7],
    note:
      'Offered as a paid add-on, never comped by default. Comping it is a Policy 7 authority decision, not an amenity booking.',
  },
}

/**
 * Values in the provided export that are impossible and must never be priced off
 * or read aloud. Quarantine, do not repair.
 */
export const DATA_QUALITY_QUARANTINE: Array<{
  property_code: string
  field: string
  observed: number
  reason: string
}> = [
  {
    property_code: 'SOL-PVD',
    field: 'base_rate_suite',
    observed: -395,
    reason: 'A negative nightly rate is impossible. Quarantined: the suite rate is reported as unavailable, never as -395 and never as 395.',
  },
]

// --------------------------------------------------------------- policy index

export interface PolicyIndexEntry {
  section_id: string
  title: string
  /** Deterministic keyword routing. No vector store: the corpus is 15 sections. */
  keywords: string[]
  /** Faithful condensation of the operative rule, used when the DB body is absent. */
  summary: string
  /** Machine-readable facts for the sections where paraphrasing is dangerous. */
  facts?: Record<string, unknown>
}

export const POLICY_INDEX: PolicyIndexEntry[] = [
  {
    section_id: '1',
    title: 'Check-in and check-out times',
    keywords: ['check in', 'check-in', 'checkin', 'check out', 'check-out', 'checkout', 'early', 'arrival time', 'departure time', '3pm', '11am'],
    summary:
      'Standard check-in is 3:00 PM and standard check-out is 11:00 AM. Early check-in and late check-out both depend on same-day room availability and are at the front desk\'s discretion. Neither is guaranteed.',
    facts: {
      check_in_local: POLICY_RULES.standard_check_in_local,
      check_out_local: POLICY_RULES.standard_check_out_local,
      early_check_in_guaranteed: false,
      late_check_out_guaranteed: false,
    },
  },
  {
    section_id: '2',
    title: 'Standard cancellation window',
    keywords: ['cancel', 'cancellation', 'refund', '72 hours', 'best available rate', 'corporate negotiated'],
    summary:
      'Best Available Rate and Corporate Negotiated bookings cancel free up to 72 hours before check-in. Inside 72 hours the guest forfeits one night room and tax, charged to the card on file.',
    facts: { window_hours: POLICY_RULES.free_cancellation_window_hours, penalty: POLICY_RULES.late_cancellation_penalty },
  },
  {
    section_id: '3',
    title: 'Advance Purchase rate',
    keywords: ['advance purchase', 'non-refundable', 'nonrefundable', 'prepaid', 'cannot change', 'weather', 'flight cancelled', 'illness'],
    summary:
      'Advance Purchase bookings are non-refundable and non-changeable from the moment they are made, including for weather, flight cancellations and illness. The front desk has no authority to waive this. The honest answer is that travel insurance, if purchased, is the only recourse.',
    facts: {
      refundable: false,
      changeable: false,
      exceptions: [],
      front_desk_may_waive: false,
      recourse: 'travel insurance if purchased',
    },
  },
  {
    section_id: '4',
    title: 'No-show policy',
    keywords: ['no show', 'no-show', 'did not arrive', 'missed my stay', 'never checked in'],
    summary:
      'A guest who has not checked in by 11:59 PM on the arrival date is marked a no-show and the full first night is charged, whatever the rate plan. For an Advance Purchase booking already paid in full there is nothing further to refund.',
    facts: { cutoff_local: POLICY_RULES.no_show_cutoff_local, charge: 'full first night', applies_to_all_rate_plans: true },
  },
  {
    section_id: '5',
    title: 'Service recovery window',
    keywords: ['service recovery', 'complaint', 'noise', 'dirty', 'broken', 'problem during my stay', 'compensation', 'credit', 'comp night'],
    summary:
      'A guest with a real problem during the stay has 72 hours after checkout to report it and be considered for a refund, a credit or a comp night. Past that window the front desk can still offer loyalty points as goodwill, but not a refund or a comp. If the guest raised the issue with housekeeping or the front desk during the stay, that counts as the complaint being made, and the 72 hours runs from checkout regardless of when they follow up.',
    facts: {
      window_hours: SERVICE_RECOVERY.window_hours,
      anchor: 'checkout',
      in_stay_complaint_counts: SERVICE_RECOVERY.in_stay_complaint_counts,
      inside_window_remedies: SERVICE_RECOVERY.inside_window_remedies,
      outside_window_remedies: SERVICE_RECOVERY.outside_window_remedies,
    },
  },
  {
    section_id: '6',
    title: 'Loyalty tier benefits at check-in',
    keywords: ['loyalty', 'tier', 'gold', 'platinum', 'silver', 'upgrade', 'late checkout', 'late check-out', 'member benefit'],
    summary:
      'Silver has no automatic perk beyond earning points. Gold gets a complimentary upgrade at check-in when one is available, plus late checkout to 1:00 PM subject to availability. Platinum gets a guaranteed upgrade to the next room class based on same-day inventory and a guaranteed late checkout to 2:00 PM, with no blackout dates and no exceptions. Two Platinum guests wanting the same last suite, or the same 2 PM checkout on a fully booked day, is an explicit gap in the written policy and is the manager on duty\'s call.',
    facts: { tiers: TIER_BENEFITS, documented_gap: 'competing Platinum claims on the same last room or the same 2 PM checkout' },
  },
  {
    section_id: '7',
    title: 'Comp and service recovery authority',
    keywords: ['comp', 'comped', 'waive', 'goodwill', 'authority', '$50', 'manager approval', 'resort fee', 'minibar'],
    summary:
      'Front desk associates can comp up to $50 per stay without manager approval, for example a waived resort fee, a minibar item or a parking charge. Anything above $50, or a full comped night, needs AGM or GM sign-off. Where a guest has two or three small issues over a multi-night stay that are each under $50, they are added up before deciding whether the front desk is still inside its own authority.',
    facts: {
      front_desk_max_cents: COMP_AUTHORITY.front_desk_max_cents,
      aggregate_per_stay: COMP_AUTHORITY.aggregate_per_stay,
      comp_night_always_escalates: COMP_AUTHORITY.comp_night_always_escalates,
    },
  },
  {
    section_id: '8',
    title: 'Pets and service animals',
    keywords: ['pet', 'pets', 'dog', 'cat', 'animal', 'service animal', 'emotional support', 'ada'],
    summary:
      'Pets are not permitted at any Solstice property, with no exceptions and no pet-friendly floors. Service animals as defined under the ADA are always welcome and stay free of charge. The front desk may ask what task the animal is trained to perform, but may not ask for certification, documentation or a demonstration, and may never charge a pet fee for a service animal.',
    facts: ANIMAL_RULES as unknown as Record<string, unknown>,
  },
  {
    section_id: '9',
    title: 'Extra guests and rollaway beds',
    keywords: ['rollaway', 'roll away', 'extra bed', 'extra guest', 'occupancy', 'crib', 'children', 'kids'],
    summary:
      'Standard rooms are set up for double occupancy and suites for up to four. Rollaway beds carry a nightly fee and are limited by the room fire-code maximum occupancy, which the property system flags automatically. Children under 12 do not count toward the rollaway fee if they are on an existing bed setup.',
    facts: {
      standard_occupancy: POLICY_RULES.standard_room_occupancy,
      suite_occupancy: POLICY_RULES.suite_occupancy,
      rollaway_fee_amount_known: false,
      child_free_under_age: POLICY_RULES.rollaway_free_child_age_under,
    },
  },
  {
    section_id: '10',
    title: 'Smoking policy',
    keywords: ['smoke', 'smoking', 'vape', 'vaping', 'e-cigarette', 'cigarette'],
    summary:
      'All Solstice properties are 100% smoke-free, including e-cigarettes and vaping, in guest rooms and indoor common areas. A violation triggers a cleaning fee of up to $250 based on housekeeping\'s assessment. Never quote an exact number up front: say a fee applies and the property determines the amount.',
    facts: { max_fee_cents: POLICY_RULES.smoking_cleaning_fee_max_cents, quote_exact_amount: false },
  },
  {
    section_id: '11',
    title: 'Lost and found',
    keywords: ['lost', 'left behind', 'found', 'forgot', 'shipping', 'jewelry', 'laptop'],
    summary:
      'Items are held for 90 days and then donated. A guest who wants something shipped back covers the shipping cost. We do not reimburse for anything left behind, including high-value items, and there is no exception process.',
    facts: { hold_days: POLICY_RULES.lost_and_found_hold_days, reimbursement: false, exception_process: false },
  },
  {
    section_id: '12',
    title: 'Parking and valet',
    keywords: ['parking', 'park', 'valet', 'garage', 'self-parking', 'car'],
    summary:
      'Parking availability and pricing vary by property: some offer free self-parking, some charge nightly, a couple are valet-only. There is no chain-wide parking rate in the front desk system, so never state a number from memory. Pull the current rate from the property fact sheet or point the guest to the on-site front desk team.',
    facts: PARKING_RULES as unknown as Record<string, unknown>,
  },
  {
    section_id: '13',
    title: 'Group block approval authority',
    keywords: ['group', 'block', 'room block', 'wedding block', 'conference', 'corporate retreat', 'rooming list'],
    summary:
      'The front desk cannot approve, modify or discount a group block. That authority sits with Sales and the General Manager, and each property has its own room-count and discount thresholds. Once a block is confirmed the front desk honours it, checks guests in against the rooming list and flags discrepancies.',
    facts: GROUP_BLOCK_RULES as unknown as Record<string, unknown>,
  },
  {
    section_id: '14',
    title: 'ID verification and incidental hold',
    keywords: ['id', 'identification', 'photo id', 'deposit', 'incidental', 'hold', 'name mismatch', 'booked for my boss'],
    summary:
      'Every guest presents a valid photo ID at check-in. Card-paying guests get a $50-per-night incidental hold; cash-paying guests leave a deposit of two times the nightly rate, refunded within 3 to 5 business days after checkout assuming no damage or extra charges. If the name on the ID does not match the reservation, do not turn the guest away: confirm the confirmation number and note the discrepancy in the reservation file.',
    facts: {
      incidental_hold_per_night_cents: POLICY_RULES.incidental_hold_per_night_cents,
      cash_deposit_multiple: POLICY_RULES.cash_deposit_nightly_rate_multiple,
      refund_window: '3 to 5 business days',
      name_mismatch_action: 'confirm the confirmation number and note the discrepancy; do not refuse the guest',
    },
  },
  {
    section_id: '15',
    title: 'Escalation matrix',
    keywords: ['escalate', 'escalation', 'manager', 'agm', 'gm', 'general manager', 'security', 'media', 'vip', 'threat', 'police'],
    summary:
      'Anything outside front-desk authority, comps over $50, refund requests outside the service recovery window, a guest dispute that is getting heated, media inquiries and VIP arrivals, goes to the Manager on duty or the AGM the same day. Anything involving guest safety, a threat or law enforcement goes straight to the General Manager and Regional Security, any hour, no exceptions, without waiting for a manager to be on-site.',
    facts: { matrix: ESCALATION_MATRIX },
  },
]
