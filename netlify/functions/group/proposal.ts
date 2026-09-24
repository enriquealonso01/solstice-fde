// Proposal rendering: one branded HTML email and one real PDF, from one source of truth.
//
// Both render from the same `ProposalDocument`, so the number in the email and the number in
// the attachment cannot disagree. The PDF is produced with pdf-lib (already a dependency) as
// actual PDF bytes, not an HTML file with a .pdf extension.
//
// Brand colours mirror the `solstice` palette in tailwind.config.js.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { GroupInquiry, Property, RuleVerdict } from '../../../shared/types'
import { formatUsd, type PricedBlock } from '../../../src/lib/rules/pricing'
import { speakDate } from '../../../src/lib/rules/dates'

const BRAND = {
  ink: '#141210',
  slate: '#2E2A26',
  stone: '#6B625A',
  sand: '#E8E1D7',
  cream: '#F7F3EC',
  ember: '#B4541F',
  gold: '#C8973F',
}

const PDF_COLORS = {
  ink: rgb(0.078, 0.071, 0.063),
  slate: rgb(0.18, 0.165, 0.149),
  stone: rgb(0.42, 0.384, 0.353),
  sand: rgb(0.91, 0.882, 0.843),
  cream: rgb(0.969, 0.953, 0.925),
  ember: rgb(0.706, 0.329, 0.122),
  white: rgb(1, 1, 1),
}

export interface ProposalDocument {
  proposal_id: string
  inquiry_id: string
  company_name: string
  contact_name: string
  property_name: string
  property_code: string
  city: string
  state: string
  arrival_date: string | null
  departure_date: string | null
  rooms: number
  nights: number
  room_type: string
  nightly_rack: number
  nightly_net: number
  discount_pct: number
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  /** Only the verdicts a customer should see: never internal thresholds. */
  customer_notes: string[]
  /** Internal, for the rep's copy and the audit trail. */
  verdicts: RuleVerdict[]
  required_follow_ups: string[]
  prepared_on: string
  expires_on: string
  general_manager: string
}

export interface BuildDocumentInput {
  proposal_id: string
  inquiry: GroupInquiry
  property: Property
  block: PricedBlock
  verdicts: RuleVerdict[]
  required_follow_ups: string[]
  customer_notes?: string[]
  prepared_on?: Date
}

/** A quote is only good for so long; 14 days is what a rep would say on the phone. */
const QUOTE_VALID_DAYS = 14

export function buildProposalDocument(input: BuildDocumentInput): ProposalDocument {
  const prepared = input.prepared_on ?? new Date()
  const expires = new Date(prepared.getTime() + QUOTE_VALID_DAYS * 86_400_000)
  return {
    proposal_id: input.proposal_id,
    inquiry_id: input.inquiry.inquiry_id,
    company_name: input.inquiry.company_name,
    contact_name: input.inquiry.contact_name,
    property_name: input.property.property_name,
    property_code: input.property.property_code,
    city: input.property.city,
    state: input.property.state,
    arrival_date: input.inquiry.arrival_date,
    departure_date: input.inquiry.departure_date,
    rooms: input.block.rooms,
    nights: input.block.nights,
    room_type: input.block.room_type,
    nightly_rack: input.block.nightly_rack_cents,
    nightly_net: input.block.nightly_net_cents,
    discount_pct: input.block.discount_pct,
    subtotal_cents: input.block.subtotal_cents,
    discount_cents: input.block.discount_cents,
    total_cents: input.block.total_cents,
    customer_notes: input.customer_notes ?? [],
    verdicts: input.verdicts,
    required_follow_ups: input.required_follow_ups,
    prepared_on: prepared.toISOString().slice(0, 10),
    expires_on: expires.toISOString().slice(0, 10),
    general_manager: input.property.general_manager,
  }
}

// ---------------------------------------------------------------- HTML

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Table-based, inline-styled HTML. Email clients are not browsers; this is written the way
 *  mail clients actually render rather than the way we would build a web page. */
export function renderProposalHtml(doc: ProposalDocument, pdfUrl?: string | null): string {
  const notes = doc.customer_notes
    .map(
      (note) =>
        `<tr><td style="padding:6px 0;color:${BRAND.slate};font-size:14px;line-height:20px;">&bull;&nbsp; ${escapeHtml(note)}</td></tr>`,
    )
    .join('')

  const followUps = doc.required_follow_ups
    .map(
      (item) =>
        `<tr><td style="padding:6px 0;color:${BRAND.ember};font-size:14px;line-height:20px;">&bull;&nbsp; ${escapeHtml(item)}</td></tr>`,
    )
    .join('')

  const pdfButton = pdfUrl
    ? `<tr><td style="padding:24px 0 0;">
         <a href="${escapeHtml(pdfUrl)}" style="display:inline-block;background:${BRAND.ink};color:${BRAND.cream};text-decoration:none;padding:12px 22px;border-radius:2px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;">Download the full proposal</a>
       </td></tr>`
    : ''

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Group proposal for ${escapeHtml(doc.company_name)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:Inter,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#ffffff;border:1px solid ${BRAND.sand};">

      <tr><td style="background:${BRAND.ink};padding:28px 32px;">
        <div style="color:${BRAND.cream};font-family:Georgia,serif;font-size:24px;letter-spacing:.14em;text-transform:uppercase;">Solstice</div>
        <div style="color:${BRAND.gold};font-size:11px;letter-spacing:.24em;text-transform:uppercase;margin-top:6px;">Group Sales</div>
      </td></tr>

      <tr><td style="padding:32px 32px 8px;">
        <div style="color:${BRAND.stone};font-size:12px;letter-spacing:.16em;text-transform:uppercase;">Proposal ${escapeHtml(doc.proposal_id)}</div>
        <h1 style="margin:10px 0 0;font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:34px;color:${BRAND.ink};">${escapeHtml(doc.property_name)}</h1>
        <div style="color:${BRAND.stone};font-size:14px;margin-top:6px;">${escapeHtml(doc.city)}, ${escapeHtml(doc.state)}</div>
      </td></tr>

      <tr><td style="padding:24px 32px 0;color:${BRAND.slate};font-size:15px;line-height:24px;">
        <p style="margin:0 0 16px;">Dear ${escapeHtml(doc.contact_name)},</p>
        <p style="margin:0 0 16px;">Thank you for thinking of us for ${escapeHtml(doc.company_name)}. Here is the group block we have put together for you, held for you until ${escapeHtml(speakDate(doc.expires_on))}.</p>
      </td></tr>

      <tr><td style="padding:16px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:${BRAND.slate};">
          <tr style="background:${BRAND.cream};">
            <th align="left" style="padding:10px 12px;font-weight:600;border:1px solid ${BRAND.sand};">Arrival</th>
            <td style="padding:10px 12px;border:1px solid ${BRAND.sand};">${escapeHtml(speakDate(doc.arrival_date))}</td>
          </tr>
          <tr>
            <th align="left" style="padding:10px 12px;font-weight:600;border:1px solid ${BRAND.sand};">Departure</th>
            <td style="padding:10px 12px;border:1px solid ${BRAND.sand};">${escapeHtml(speakDate(doc.departure_date))}</td>
          </tr>
          <tr style="background:${BRAND.cream};">
            <th align="left" style="padding:10px 12px;font-weight:600;border:1px solid ${BRAND.sand};">Rooms</th>
            <td style="padding:10px 12px;border:1px solid ${BRAND.sand};">${doc.rooms} &times; ${escapeHtml(doc.room_type)}, ${doc.nights} night${doc.nights === 1 ? '' : 's'}</td>
          </tr>
          <tr>
            <th align="left" style="padding:10px 12px;font-weight:600;border:1px solid ${BRAND.sand};">Nightly rate</th>
            <td style="padding:10px 12px;border:1px solid ${BRAND.sand};">${formatUsd(doc.nightly_net)} per room, per night${doc.discount_pct > 0 ? ` <span style="color:${BRAND.stone};">(${doc.discount_pct}% off ${formatUsd(doc.nightly_rack)})</span>` : ''}</td>
          </tr>
          <tr style="background:${BRAND.ink};color:${BRAND.cream};">
            <th align="left" style="padding:14px 12px;font-weight:600;border:1px solid ${BRAND.ink};">Total for the block</th>
            <td style="padding:14px 12px;border:1px solid ${BRAND.ink};font-size:18px;">${formatUsd(doc.total_cents)}</td>
          </tr>
        </table>
      </td></tr>

      ${
        notes
          ? `<tr><td style="padding:24px 32px 0;">
               <div style="color:${BRAND.stone};font-size:12px;letter-spacing:.16em;text-transform:uppercase;padding-bottom:6px;">Good to know</div>
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${notes}</table>
             </td></tr>`
          : ''
      }

      ${
        followUps
          ? `<tr><td style="padding:20px 32px 0;">
               <div style="color:${BRAND.ember};font-size:12px;letter-spacing:.16em;text-transform:uppercase;padding-bottom:6px;">Before we can confirm</div>
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${followUps}</table>
             </td></tr>`
          : ''
      }

      <tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pdfButton}</table>
      </td></tr>

      <tr><td style="padding:28px 32px 32px;color:${BRAND.slate};font-size:15px;line-height:24px;">
        <p style="margin:0 0 4px;">With best wishes,</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:18px;color:${BRAND.ink};">Sol</p>
        <p style="margin:2px 0 0;color:${BRAND.stone};font-size:13px;">Group Sales, on behalf of ${escapeHtml(doc.general_manager)}, General Manager</p>
      </td></tr>

      <tr><td style="background:${BRAND.cream};padding:18px 32px;border-top:1px solid ${BRAND.sand};color:${BRAND.stone};font-size:12px;line-height:18px;">
        Reference ${escapeHtml(doc.inquiry_id)} &middot; prepared ${escapeHtml(speakDate(doc.prepared_on))} &middot; rates quoted exclude tax and are held until ${escapeHtml(speakDate(doc.expires_on))}.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

/** Plain-text twin of the email, for clients that will not render HTML. */
export function renderProposalText(doc: ProposalDocument, pdfUrl?: string | null): string {
  const lines = [
    `SOLSTICE HOTELS — GROUP SALES`,
    `Proposal ${doc.proposal_id} for ${doc.company_name}`,
    '',
    `Dear ${doc.contact_name},`,
    '',
    `Thank you for thinking of us. Here is the group block we have put together for you at ${doc.property_name} in ${doc.city}, ${doc.state}.`,
    '',
    `Arrival:        ${speakDate(doc.arrival_date)}`,
    `Departure:      ${speakDate(doc.departure_date)}`,
    `Rooms:          ${doc.rooms} x ${doc.room_type}, ${doc.nights} night${doc.nights === 1 ? '' : 's'}`,
    `Nightly rate:   ${formatUsd(doc.nightly_net)} per room per night${doc.discount_pct > 0 ? ` (${doc.discount_pct}% off ${formatUsd(doc.nightly_rack)})` : ''}`,
    `Block total:    ${formatUsd(doc.total_cents)}`,
    '',
  ]
  if (doc.customer_notes.length) {
    lines.push('Good to know:')
    for (const note of doc.customer_notes) lines.push(`  - ${note}`)
    lines.push('')
  }
  if (doc.required_follow_ups.length) {
    lines.push('Before we can confirm:')
    for (const item of doc.required_follow_ups) lines.push(`  - ${item}`)
    lines.push('')
  }
  if (pdfUrl) lines.push(`Full proposal: ${pdfUrl}`, '')
  lines.push(
    'With best wishes,',
    'Sol',
    `Group Sales, on behalf of ${doc.general_manager}, General Manager`,
    '',
    `Reference ${doc.inquiry_id}. Rates exclude tax and are held until ${speakDate(doc.expires_on)}.`,
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------- PDF

const PAGE = { width: 612, height: 792, margin: 56 }

interface Cursor {
  y: number
}

function drawWrapped(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  cursor: Cursor,
  maxWidth: number,
  color = PDF_COLORS.slate,
  lineGap = 4,
): void {
  const words = text.split(/\s+/)
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      page.drawText(line, { x, y: cursor.y, size, font, color })
      cursor.y -= size + lineGap
      line = word
    } else {
      line = candidate
    }
  }
  if (line) {
    page.drawText(line, { x, y: cursor.y, size, font, color })
    cursor.y -= size + lineGap
  }
}

/** Produces real PDF bytes. */
export async function renderProposalPdf(doc: ProposalDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Solstice group proposal ${doc.proposal_id}`)
  pdf.setAuthor('Solstice Hotels — Group Sales')
  pdf.setSubject(`Group block for ${doc.company_name} at ${doc.property_name}`)
  pdf.setProducer('Solstice FDE')

  const page = pdf.addPage([PAGE.width, PAGE.height])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const serif = await pdf.embedFont(StandardFonts.TimesRoman)

  const contentWidth = PAGE.width - PAGE.margin * 2

  // Brand band
  page.drawRectangle({ x: 0, y: PAGE.height - 96, width: PAGE.width, height: 96, color: PDF_COLORS.ink })
  page.drawText('SOLSTICE', {
    x: PAGE.margin,
    y: PAGE.height - 56,
    size: 24,
    font: serif,
    color: PDF_COLORS.cream,
  })
  page.drawText('GROUP SALES', {
    x: PAGE.margin,
    y: PAGE.height - 79,
    size: 9,
    font: regular,
    color: PDF_COLORS.ember,
  })
  page.drawText(doc.proposal_id, {
    x: PAGE.width - PAGE.margin - regular.widthOfTextAtSize(doc.proposal_id, 10),
    y: PAGE.height - 56,
    size: 10,
    font: regular,
    color: PDF_COLORS.cream,
  })

  const cursor: Cursor = { y: PAGE.height - 140 }

  page.drawText(doc.property_name, {
    x: PAGE.margin,
    y: cursor.y,
    size: 20,
    font: serif,
    color: PDF_COLORS.ink,
  })
  cursor.y -= 20
  page.drawText(`${doc.city}, ${doc.state}`, {
    x: PAGE.margin,
    y: cursor.y,
    size: 10,
    font: regular,
    color: PDF_COLORS.stone,
  })
  cursor.y -= 30

  drawWrapped(
    page,
    `Prepared for ${doc.contact_name} at ${doc.company_name}. Reference ${doc.inquiry_id}.`,
    regular,
    11,
    PAGE.margin,
    cursor,
    contentWidth,
  )
  cursor.y -= 14

  // Detail rows
  const rows: [string, string][] = [
    ['Arrival', speakDate(doc.arrival_date)],
    ['Departure', speakDate(doc.departure_date)],
    ['Room block', `${doc.rooms} x ${doc.room_type}`],
    ['Nights', String(doc.nights)],
    [
      'Nightly rate',
      doc.discount_pct > 0
        ? `${formatUsd(doc.nightly_net)} (${doc.discount_pct}% off ${formatUsd(doc.nightly_rack)})`
        : formatUsd(doc.nightly_net),
    ],
    ['Rooms subtotal', formatUsd(doc.subtotal_cents)],
    ['Group discount', `-${formatUsd(doc.discount_cents)}`],
  ]

  for (const [label, value] of rows) {
    page.drawRectangle({
      x: PAGE.margin,
      y: cursor.y - 5,
      width: contentWidth,
      height: 22,
      color: PDF_COLORS.cream,
    })
    page.drawText(label, { x: PAGE.margin + 10, y: cursor.y + 1, size: 10, font: bold, color: PDF_COLORS.slate })
    page.drawText(value, {
      x: PAGE.margin + 190,
      y: cursor.y + 1,
      size: 10,
      font: regular,
      color: PDF_COLORS.slate,
    })
    cursor.y -= 26
  }

  // Total band
  page.drawRectangle({ x: PAGE.margin, y: cursor.y - 8, width: contentWidth, height: 32, color: PDF_COLORS.ink })
  page.drawText('TOTAL FOR THE BLOCK', {
    x: PAGE.margin + 10,
    y: cursor.y + 4,
    size: 10,
    font: bold,
    color: PDF_COLORS.cream,
  })
  const totalText = formatUsd(doc.total_cents)
  page.drawText(totalText, {
    x: PAGE.margin + contentWidth - 10 - bold.widthOfTextAtSize(totalText, 14),
    y: cursor.y + 2,
    size: 14,
    font: bold,
    color: PDF_COLORS.white,
  })
  cursor.y -= 48

  if (doc.customer_notes.length) {
    page.drawText('GOOD TO KNOW', { x: PAGE.margin, y: cursor.y, size: 9, font: bold, color: PDF_COLORS.stone })
    cursor.y -= 16
    for (const note of doc.customer_notes) {
      drawWrapped(page, `•  ${note}`, regular, 10, PAGE.margin, cursor, contentWidth)
      cursor.y -= 4
    }
    cursor.y -= 10
  }

  if (doc.required_follow_ups.length) {
    page.drawText('BEFORE WE CAN CONFIRM', {
      x: PAGE.margin,
      y: cursor.y,
      size: 9,
      font: bold,
      color: PDF_COLORS.ember,
    })
    cursor.y -= 16
    for (const item of doc.required_follow_ups) {
      drawWrapped(page, `•  ${item}`, regular, 10, PAGE.margin, cursor, contentWidth, PDF_COLORS.ember)
      cursor.y -= 4
    }
    cursor.y -= 10
  }

  // Next steps. Deliberately says nothing the data does not support: the hold date is the only
  // commitment made anywhere on this page, and it comes from the proposal itself.
  if (cursor.y > 250) {
    page.drawText('NEXT STEPS', { x: PAGE.margin, y: cursor.y, size: 9, font: bold, color: PDF_COLORS.stone })
    cursor.y -= 16
    for (const step of [
      'Reply to this proposal to accept, and we will confirm the block.',
      `Rates above are held until ${speakDate(doc.expires_on)}.`,
      'Any change to dates, room count or discount comes back to us before it is confirmed.',
    ]) {
      drawWrapped(page, `•  ${step}`, regular, 10, PAGE.margin, cursor, contentWidth)
      cursor.y -= 4
    }
    cursor.y -= 12
  }

  // Acceptance strip, only when there is genuine room for it. Without this the page ran from the
  // total straight to the footer with a large void in between.
  if (cursor.y > 190) {
    const lineY = 150
    const half = (contentWidth - 24) / 2
    page.drawLine({
      start: { x: PAGE.margin, y: lineY },
      end: { x: PAGE.margin + half, y: lineY },
      thickness: 0.5,
      color: PDF_COLORS.stone,
    })
    page.drawLine({
      start: { x: PAGE.margin + half + 24, y: lineY },
      end: { x: PAGE.margin + contentWidth, y: lineY },
      thickness: 0.5,
      color: PDF_COLORS.stone,
    })
    page.drawText('Authorised signature', {
      x: PAGE.margin,
      y: lineY - 12,
      size: 8,
      font: regular,
      color: PDF_COLORS.stone,
    })
    page.drawText('Date', {
      x: PAGE.margin + half + 24,
      y: lineY - 12,
      size: 8,
      font: regular,
      color: PDF_COLORS.stone,
    })
  }

  // Footer
  page.drawLine({
    start: { x: PAGE.margin, y: 96 },
    end: { x: PAGE.width - PAGE.margin, y: 96 },
    thickness: 0.5,
    color: PDF_COLORS.sand,
  })
  const footerCursor: Cursor = { y: 80 }
  drawWrapped(
    page,
    `Prepared ${speakDate(doc.prepared_on)} by Sol, Solstice Group Sales, on behalf of ${doc.general_manager}, General Manager. Rates exclude tax and are held until ${speakDate(doc.expires_on)}.`,
    regular,
    8,
    PAGE.margin,
    footerCursor,
    contentWidth,
    PDF_COLORS.stone,
  )

  return await pdf.save()
}

export function pdfFilename(doc: ProposalDocument): string {
  const company = doc.company_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `Solstice-proposal-${doc.proposal_id}-${company}.pdf`
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
