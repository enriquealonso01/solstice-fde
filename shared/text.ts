/**
 * Text helpers for anything a customer reads.
 *
 * WHY THIS EXISTS. Customer-facing strings are templates with data dropped into them, and the two
 * collide at the seam. Two instances found in production, both only visible once real data met the
 * template, so neither could have been caught by reading the source:
 *
 *   "we are passing this to the the Boston-area sister property"   (PR #33)
 *     the template supplied an article; the configured value already had one.
 *
 *   "Prepared for Kevin Marsh at Ocean State University Alumni Assoc.. Reference INQ-2007."
 *     the template supplied a full stop; the company name is an abbreviation that ends in one.
 *
 * The second is on the proposal PDF for INQ-2007, which is the document the demo runbook puts on
 * screen. One company in ten happens to end in a period, so nine tenths of the data hides it.
 */

/** Sentence-ending punctuation that should never be doubled. */
const TERMINATORS = ['.', '!', '?', '…']

/**
 * End a sentence whose last element is interpolated data, without doubling the punctuation.
 *
 *   endSentence('Prepared for Kevin at Ocean State Alumni Assoc.')  -> '...Assoc.'
 *   endSentence('Prepared for Kevin at Harlow & Vance Consulting')  -> '...Consulting.'
 *
 * Trailing whitespace is trimmed first, so `endSentence('Acme ')` gives `'Acme.'` rather than
 * `'Acme .'` — a space before a full stop being the other way this seam goes wrong.
 */
export function endSentence(text: string, punctuation = '.'): string {
  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed) return trimmed
  for (const end of TERMINATORS) {
    if (trimmed.endsWith(end)) return trimmed
  }
  return trimmed + punctuation
}
