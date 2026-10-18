import { composedSlideSchema, type ComposedSlide } from '@lct/contracts';

const REQUIREMENT_MAX = 1000;
const REQUIREMENT_COUNT_MAX = 20;
const REQUIREMENT_TOTAL_MAX = 6000;
const REPORT_TEXT_MAX = 300;
const JSON_LIMIT = 10_000;

const UNITS = ['млрд', 'млн', 'тыс', 'руб', 'кг', 'км', 'шт', '%'];

export class ContentCoverageError extends Error {
  readonly code: 'invalid_slide' | 'invalid_requirements' | 'report_too_large';

  constructor(
    code: 'invalid_slide' | 'invalid_requirements' | 'report_too_large',
    message: string,
  ) {
    super(message);
    this.name = 'ContentCoverageError';
    this.code = code;
  }
}

export type CoverageItemStatus = 'covered' | 'requires-review';

export type CoverageItem = {
  index: number;
  text: string;
  status: CoverageItemStatus;
  evidence?: string;
  reasons: string[];
};

export type ContentCoverage = {
  status: CoverageItemStatus;
  requiredCount: number;
  coveredCount: number;
  items: CoverageItem[];
  sourceFactChecking: false;
};

type Fragment = { raw: string; folded: string };

function fail(code: ContentCoverageError['code'], message: string): never {
  throw new ContentCoverageError(code, message);
}

function symbols(value: string): string[] {
  return Array.from(value);
}

function isWord(symbol: string | undefined): boolean {
  return symbol !== undefined && /[\p{L}\p{N}]/u.test(symbol);
}

function isDigit(symbol: string | undefined): boolean {
  return symbol !== undefined && /\p{N}/u.test(symbol);
}

const NUMBER_SIGNS = new Set(['+', '-', '\u2212', '\u2013']);

function literalEscapes(hay: readonly string[], start: number, needle: readonly string[]): boolean {
  const end = start + needle.length;
  let index = 0;
  while (index < needle.length) {
    if (!isDigit(needle[index])) {
      index += 1;
      continue;
    }
    const run = index;
    while (isDigit(needle[index])) index += 1;
    const runStart = start + run;
    const runEnd = start + index;
    if (run === 0 && NUMBER_SIGNS.has(hay[runStart - 1] ?? '')) return true;
    if (runEnd !== end) continue;
    const after = hay[end];
    if (isDigit(after)) return true;
    if ((after === '.' || after === ',') && isDigit(hay[end + 1])) return true;
    if (after === ' ') {
      let cursor = end + 1;
      let group = 0;
      while (isDigit(hay[cursor]) && group < 3) {
        group += 1;
        cursor += 1;
      }
      if (group === 3 && !isDigit(hay[cursor])) return true;
    }
  }
  return false;
}
function collapse(value: string): Fragment {
  const raw = value
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return { raw, folded: raw.toLowerCase() };
}

function findBounded(haystack: string, needle: string): number | null {
  const hay = symbols(haystack);
  const need = symbols(needle);
  if (need.length === 0 || need.length > hay.length) return null;
  for (let start = 0; start <= hay.length - need.length; start += 1) {
    let same = true;
    for (let offset = 0; offset < need.length; offset += 1) {
      if (hay[start + offset] !== need[offset]) {
        same = false;
        break;
      }
    }
    if (!same) continue;
    if (
      !isWord(hay[start - 1]) &&
      !isWord(hay[start + need.length]) &&
      !literalEscapes(hay, start, need)
    )
      return start;
  }
  return null;
}

function evidenceAt(fragment: Fragment, foldedStart: number, needle: string): string | null {
  const raw = symbols(fragment.raw);
  const map: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    for (const _lower of symbols((raw[index] ?? '').toLowerCase())) map.push(index);
  }
  const width = symbols(needle).length;
  const from = map[foldedStart];
  const to = map[foldedStart + width - 1];
  if (from === undefined || to === undefined) return null;
  const quote = raw.slice(from, to + 1).join('');
  return fragment.raw.includes(quote) ? quote : null;
}
function fragmentsOf(slide: ComposedSlide): Fragment[] {
  const parts: string[] = [];
  for (const slot of slide.texts) parts.push(slot.text);
  const visual = slide.visual;
  if (visual?.kind === 'table') {
    parts.push(...visual.headers);
    for (const row of visual.rows) parts.push(...row);
  }
  if (visual?.kind === 'chart') {
    parts.push(...visual.categories);
    for (const series of visual.series) {
      parts.push(series.name);
      for (const value of series.values) parts.push(String(value));
    }
    parts.push(visual.xTitle, visual.yTitle);
  }
  return parts.map(collapse).filter((part) => part.folded.length > 0);
}

function matchIn(parts: readonly Fragment[], needle: string): string | null {
  const foldedNeedle = collapse(needle).folded;
  if (foldedNeedle.length === 0) return null;
  for (const part of parts) {
    const at = findBounded(part.folded, foldedNeedle);
    if (at === null) continue;
    const quote = evidenceAt(part, at, foldedNeedle);
    if (quote !== null) return quote;
  }
  return null;
}

function withoutToken(value: string, token: string): string {
  const symbolsOf = symbols(value);
  const tokenSymbols = symbols(token);
  const kept: string[] = [];
  for (let index = 0; index < symbolsOf.length;) {
    const room = symbolsOf.length - index >= tokenSymbols.length;
    const same =
      room && tokenSymbols.every((symbol, offset) => symbolsOf[index + offset] === symbol);
    const before = symbolsOf[index - 1];
    const after = symbolsOf[index + tokenSymbols.length];
    if (same && !isWord(before) && !isWord(after)) {
      index += tokenSymbols.length;
      continue;
    }
    const symbol = symbolsOf[index];
    if (symbol !== undefined) kept.push(symbol);
    index += 1;
  }
  return collapse(kept.join('')).folded;
}

function reasonsFor(requirement: string, parts: readonly Fragment[]): string[] {
  const folded = collapse(requirement).folded;
  const reasons: string[] = [];
  const withoutNegation = withoutToken(withoutToken(folded, 'не'), 'not');
  if (withoutNegation !== folded && withoutNegation.length > 0 && matchIn(parts, withoutNegation)) {
    reasons.push('negation-lost');
  }
  const conditionAt = folded.indexOf(' при ');
  const englishCondition = folded.indexOf(' if ');
  const cut = conditionAt >= 0 ? conditionAt : englishCondition;
  if (cut > 0 && matchIn(parts, folded.slice(0, cut))) reasons.push('condition-lost');
  for (const unit of UNITS) {
    const withoutUnit = withoutToken(folded, unit);
    if (withoutUnit !== folded && withoutUnit.length > 0 && matchIn(parts, withoutUnit)) {
      reasons.push('unit-lost');
      break;
    }
  }
  for (const number of folded.match(/\d+/g) ?? []) {
    const insideLonger = parts.some((part) => {
      const hay = symbols(part.folded);
      const need = symbols(number);
      for (let start = 0; start <= hay.length - need.length; start += 1) {
        if (need.some((symbol, offset) => hay[start + offset] !== symbol)) continue;
        if (
          isWord(hay[start - 1]) ||
          isWord(hay[start + need.length]) ||
          literalEscapes(hay, start, need)
        )
          return true;
      }
      return false;
    });
    if (insideLonger) {
      reasons.push('number-boundary');
      break;
    }
  }
  if (reasons.length === 0) reasons.push('not-found');
  return reasons;
}

function reportText(value: string, reasons: string[], code: string): string {
  const chars = symbols(value);
  if (chars.length <= REPORT_TEXT_MAX) return value;
  reasons.push(code);
  return chars.slice(0, REPORT_TEXT_MAX).join('');
}

function requirementsOf(required: readonly string[]): string[] {
  if (required.length < 1 || required.length > REQUIREMENT_COUNT_MAX) {
    fail('invalid_requirements', 'Нужно от 1 до 20 требований.');
  }
  let total = 0;
  for (const item of required) {
    if (typeof item !== 'string' || item.length < 1 || item.length > REQUIREMENT_MAX) {
      fail('invalid_requirements', 'Каждое требование должно быть строкой от 1 до 1000 символов.');
    }
    if (collapse(item).folded.length === 0) {
      fail('invalid_requirements', 'Требование не может состоять только из пробелов.');
    }
    total += item.length;
  }
  if (total > REQUIREMENT_TOTAL_MAX) {
    fail('invalid_requirements', 'Суммарная длина требований больше 6000 символов.');
  }
  return [...required];
}

/**
 * A requirement is covered only when its normalized text sits inside one visible fragment,
 * on word boundaries. Speaker notes, field names and looser paraphrases do not count.
 */
export function checkContentCoverage(required: readonly string[], slide: unknown): ContentCoverage {
  const requirements = requirementsOf(required);
  const parsed = composedSlideSchema.safeParse(slide);
  if (!parsed.success) fail('invalid_slide', 'Слайд не прошёл проверку схемы.');
  const parts = fragmentsOf(parsed.data);
  const items: CoverageItem[] = requirements.map((requirement, index) => {
    const evidence = matchIn(parts, requirement);
    if (evidence !== null) {
      const reasons: string[] = [];
      return {
        index,
        text: reportText(requirement, reasons, 'report-text-trimmed'),
        status: 'covered',
        evidence: reportText(evidence, reasons, 'evidence-trimmed'),
        reasons,
      };
    }
    const reasons = reasonsFor(requirement, parts);
    return {
      index,
      text: reportText(requirement, reasons, 'report-text-trimmed'),
      status: 'requires-review',
      reasons,
    };
  });
  const coveredCount = items.filter((item) => item.status === 'covered').length;
  const report: ContentCoverage = {
    status: coveredCount === items.length ? 'covered' : 'requires-review',
    requiredCount: items.length,
    coveredCount,
    items,
    sourceFactChecking: false,
  };
  if (JSON.stringify(report).length >= JSON_LIMIT) {
    fail('report_too_large', 'Отчёт о покрытии не помещается в 10000 символов.');
  }
  return report;
}
