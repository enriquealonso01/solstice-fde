/**
 * A group inquiry's raw email and phone live in `inquiry_contacts`; the payload staff can read holds
 * only the masked pair. A masked value must never land in a raw slot, where delivery would send to
 * it, or be written over the one raw copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadInquiry,
  loadInquiryContact,
  registerInquiry,
  resetRegisteredInquiries,
  resetRehydratedInquiries,
  saveInquiryContact,
} from '../../../../netlify/functions/group/_deps'
import { routeFor } from '../../../../netlify/functions/_delivery/config'

type Row = Record<string, unknown>

/** In-memory `inquiries` and `inquiry_contacts`, recording every write. */
const db = vi.hoisted(() => ({
  inquiries: [] as Row[],
  contacts: new Map<string, Row>(),
  contactsTableExists: true,
  writes: [] as Array<{ table: string; row: Row }>,
}))

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const missing = table === 'inquiry_contacts' && !db.contactsTableExists
      const rows = () =>
        (table === 'inquiries' ? db.inquiries : table === 'inquiry_contacts' ? [...db.contacts.values()] : []).filter((r) =>
          filters.every(([key, value]) => r[key] === value),
        )
      const result = () =>
        missing ? { data: null, error: { code: 'PGRST205', message: 'relation does not exist' } } : { data: rows(), error: null }
      const write = (row: Row) => {
        db.writes.push({ table, row })
        if (table === 'inquiry_contacts' && !missing) {
          const code = String(row.inquiry_code)
          db.contacts.set(code, { ...db.contacts.get(code), ...row })
        }
      }
      // A chainable query: unknown calls (order, limit, ...) return the same builder.
      const builder: Row = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(result())
            if (prop === 'maybeSingle' || prop === 'single') {
              return async () => {
                const r = result()
                return { data: r.data?.[0] ?? null, error: r.error }
              }
            }
            if (prop === 'eq') return (key: string, value: unknown) => (filters.push([key, value]), builder)
            if (prop === 'upsert' || prop === 'insert') return (row: Row) => (write(row), builder)
            return () => builder
          },
        },
      )
      return builder
    },
  }
}

vi.mock('../../../../netlify/functions/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../netlify/functions/_lib/db')>()),
  tryGetDb: () => fakeClient(),
}))

const CODE = 'INQ-2011'
const RAW = { email: 'dana@example.com', phone: '+13055557788' }

/** What persistInquiry writes: the contact masked. */
const persisted: Row = {
  inquiry_code: CODE,
  source: 'voice',
  missing_fields: [],
  payload: {
    company_name: 'Cypress Ridge Reunion',
    contact_name: 'Dana Alvarez',
    contact_email: 'd***@example.com',
    contact_phone: '+*******7788',
    preferred_property_code: 'SOL-TPA',
    rooms_requested: 20,
  },
}

const hasMask = (value: unknown) => typeof value === 'string' && value.includes('*')

beforeEach(() => {
  db.inquiries = [persisted]
  db.contacts = new Map([[CODE, { inquiry_code: CODE, ...RAW }]])
  db.contactsTableExists = true
  db.writes = []
  resetRegisteredInquiries()
  resetRehydratedInquiries()
})

/** What update_inquiry does on a cold instance: load the rehydrated inquiry, merge, register. */
async function updateAfterColdStart(changes: Row): Promise<void> {
  const current = await loadInquiry(CODE)
  expect(current).not.toBeNull()
  registerInquiry({ ...current!, ...changes })
}

describe('an inquiry updated after a cold start', () => {
  it('never carries a masked value as its raw contact, and reads the raw one from inquiry_contacts', async () => {
    await updateAfterColdStart({ rooms_requested: 22 })
    const contact = await loadInquiryContact(CODE)
    expect(contact).toMatchObject(RAW)
    expect(routeFor({ email: contact?.email, phone: contact?.phone })).toBe('email')
  })

  it('writes nothing over the stored contact when it learned no new one', async () => {
    await updateAfterColdStart({ rooms_requested: 22 })
    expect(await saveInquiryContact(CODE)).toBe(false)
    expect(db.contacts.get(CODE)).toMatchObject(RAW)
    expect(db.writes.filter((w) => w.table === 'inquiry_contacts')).toEqual([])
  })

  it('saves a new phone on its own, leaving the stored email untouched', async () => {
    await updateAfterColdStart({ contact_phone: '+13055550000' })
    expect(await loadInquiryContact(CODE)).toMatchObject({ email: RAW.email, phone: '+13055550000' })

    expect(await saveInquiryContact(CODE)).toBe(true)
    const written = db.writes.filter((w) => w.table === 'inquiry_contacts').map((w) => w.row)
    expect(written).toEqual([{ inquiry_code: CODE, phone: '+13055550000' }])
    expect(db.contacts.get(CODE)).toMatchObject({ email: RAW.email, phone: '+13055550000' })
  })

  it('never writes a masked value to inquiry_contacts, whatever it is handed', async () => {
    await updateAfterColdStart({ contact_email: 'd***@example.com', contact_phone: '+*******7788' })
    await saveInquiryContact(CODE)
    expect(db.writes.filter((w) => w.table === 'inquiry_contacts' && Object.values(w.row).some(hasMask))).toEqual([])
  })
})

describe('before the inquiry_contacts table exists', () => {
  it('keeps the masked pair only, so delivery routes to a human', async () => {
    db.contactsTableExists = false
    const contact = await loadInquiryContact(CODE)
    expect(contact).toMatchObject({ email: null, phone: null, email_masked: 'd***@example.com', phone_masked: '+*******7788' })
    expect(routeFor({ email: contact?.email, phone: contact?.phone })).toBe('human')
  })

  it('still reads a seeded inquiry’s raw contact from the generated data', async () => {
    db.contactsTableExists = false
    const contact = await loadInquiryContact('INQ-2004')
    expect(contact?.email).toBeTruthy()
    expect(hasMask(contact?.email)).toBe(false)
  })
})
