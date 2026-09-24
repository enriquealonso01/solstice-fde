// Public surface of the group rules engine.
//
// Everything the app, the functions, and the tests need is re-exported here so that callers
// never reach into an internal module. Business rules are DATA: see thresholds.ts for the
// per-property control surface and seasonal.ts for the rules lifted out of the free-text notes.

export * from './types'
export * from './dates'
export * from './validation'
export * from './completeness'
export * from './seasonal'
export * from './thresholds'
export * from './pricing'
export * from './engine'
export * from './alternates'
export * from './options'

// No data lives here. Properties and inquiries come from data/generated via
// netlify/functions/_lib/data.ts; this package is pure logic so it stays browser-safe and
// so there is exactly one copy of the hotel data in the repository.
