import type { Claim } from '@lct/contracts';

/**
 * Deterministic checks for a claim a writer wants to use.
 *
 * A quote counts only when it is a non-empty exact substring of the source. A figure's value
 * and its whole unit can be located in that quote: sign and decimal separator included, and a
 * unit compared in full, so "м" is not "мм" and a word like "рублей" is not an absent unit.
 * Locating the figure does not confirm which object or period it belongs to. That link needs a
 * source cell this checker does not have, so the claim stays unverified. These functions do not
 * call a model and do not use the network.
 */

/**
 * A figure taken from draft copy. Every field is required.
 * Null means the figure has no unit, period, or object. Omitting a field is not a match.
 */
export interface NumberToken {
  readonly value: number;
  readonly unit: string | null;
  readonly period: string | null;
  /** Object the figure is about. Null when the figure names none. */
  readonly scope: string | null;
}

/** True only when `quote` is a non-empty exact substring of `sourceText`. */
export function quoteOccurs(quote: string, sourceText: string): boolean {
  return quote.length > 0 && sourceText.includes(quote);
}

type QuantityClaim = Extract<Claim, { status: 'user' | 'web' }>;

function usableQuantity(claim: Claim): QuantityClaim | null {
  if (claim.status === 'user') return claim;
  if (claim.status === 'web' && claim.accepted) return claim;
  return null;
}

/** Consume the entire numeric run before validating its grouping and decimal separator. */
const NUMBER_TOKEN = /[+\u2212-]?\d+(?:[ \t\u00a0\u202f.,]+\d+)*/gu;

interface ParsedNumber {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

/** `grounded` is reserved for a source cell. Nothing here produces it. */
export type QuantitySupport = 'grounded' | 'unverified' | 'mismatch';

export interface QuantityCheck {
  /** The quote contains this value with this full unit. That is not confirmation of the claim. */
  readonly numberAndUnit: boolean;
  readonly support: QuantitySupport;
}

function parseToken(raw: string): number | null {
  if (!/^[+\u2212-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/u.test(raw)) {
    return null;
  }
  const normalized = raw
    .replace(/[ \u00a0\u202f]/gu, '')
    .replace('\u2212', '-')
    .replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Every number in `text`, each consumed whole so 25 is not read out of 25,7 or 1,25. */
function parseNumbers(text: string): ParsedNumber[] {
  const found: ParsedNumber[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const raw = match[0];
    // A malformed sign or decimal prefix must not expose a valid numeric suffix.
    if (match.index > 0 && /[\p{L}\p{N}.,+\u2212-]/u.test(text.charAt(match.index - 1))) continue;
    const value = parseToken(raw);
    if (value === null || match.index === undefined) continue;
    found.push({ value, start: match.index, end: match.index + raw.length });
  }
  return found;
}

/** Keep symbols and compound units intact; an unknown unit is still present. */
function readUnit(text: string, numberEnd: number): string | null {
  const rest = text.slice(numberEnd);
  const spacing = /^\s*/u.exec(rest)?.[0].length ?? 0;
  const after = rest.slice(spacing);
  const unit =
    /^[^\s,;:!?()[\]{}"'«»]+(?:\s+[/·*^]\s*[^\s,;:!?()[\]{}"'«»]*)*/u.exec(after)?.[0] ?? '';
  // A sentence-ending dot is punctuation, while internal dots belong to the unit.
  return unit.replace(/\.+$/u, '') || null;
}

function unitMatches(text: string, token: ParsedNumber, unit: string | undefined): boolean {
  const found = readUnit(text, token.end);
  if (unit === undefined) return found === null;
  return found === unit;
}

/** True when the quote has this value with this whole unit. Scope and period are ignored. */
function figureLocated(claim: QuantityClaim): boolean {
  if (claim.value === undefined || !Number.isFinite(claim.value)) return false;
  const value = claim.value;
  return parseNumbers(claim.quote).some(
    (token) => token.value === value && unitMatches(claim.quote, token, claim.unit),
  );
}

function sameContext(tokenField: string | null, claimField: string | undefined): boolean {
  return tokenField === (claimField ?? null);
}

const MISMATCH: QuantityCheck = { numberAndUnit: false, support: 'mismatch' };

/**
 * Locates a value and its unit, and says whether the claim is confirmed.
 * Confirmation stays `unverified` until a source cell binds the figure to its object and period.
 * `numberIsGrounded` is that confirmation and is therefore false here.
 */
export function checkQuantity(token: NumberToken, claim: Claim): QuantityCheck {
  const fact = usableQuantity(claim);
  if (
    !fact ||
    fact.value === undefined ||
    !Number.isFinite(token.value) ||
    !Number.isFinite(fact.value) ||
    fact.value !== token.value
  ) {
    return MISMATCH;
  }
  if (!sameContext(token.unit, fact.unit)) return MISMATCH;
  if (!sameContext(token.period, fact.period)) return MISMATCH;
  if (!sameContext(token.scope, fact.scope)) return MISMATCH;
  if (!figureLocated(fact)) return MISMATCH;
  return { numberAndUnit: true, support: 'unverified' };
}

/** True only when a source cell has confirmed the claim. Locating a number is not enough. */
export function numberIsGrounded(token: NumberToken, claim: Claim): boolean {
  return checkQuantity(token, claim).support === 'grounded';
}

function usableQuote(claim: Claim): string | null {
  if (claim.status === 'user') return claim.quote;
  if (claim.status === 'web' && claim.accepted) return claim.quote;
  return null;
}

/**
 * True only when a usable claim's quote contains the name as an exact substring.
 * A contradiction, an insufficient record, an assumption, or an unaccepted web claim cannot
 * support a name, even when the text mentions one.
 */
export function nameIsGrounded(name: string, claim: Claim): boolean {
  const quote = usableQuote(claim);
  return quote !== null && quoteOccurs(name, quote);
}
