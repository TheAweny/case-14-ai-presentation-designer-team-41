import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

/** One research child at a time on the current async path. A nested call is refused. */
const delegateDepth = new AsyncLocalStorage<number>();

const DEFAULT_MAX_CALLS = 3;
const EXCERPT_CHARS = 180;
const MISSING_FACT = 'The fact is missing.';

const CAP_QUESTION = {
  calls: 'Call cap reached before the question was fully answered.',
  deadline: 'Deadline reached before the question was fully answered.',
  output: 'Output cap reached before the question was fully answered.',
} as const;

type CapReason = keyof typeof CAP_QUESTION;

export class InvalidResearchLimitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchLimitsError';
  }
}

export class NestedResearchDelegateError extends Error {
  constructor() {
    super('A research delegate cannot call another research delegate.');
    this.name = 'NestedResearchDelegateError';
  }
}

export interface ResearchEvidence {
  readonly url: string;
  /** Exact slice of the fetched text. Whitespace is not rewritten. */
  readonly quote: string;
  /** Index of `quote` in that text. */
  readonly start: number;
}

/** What the child returns. The search transcript is never part of this value. */
export interface ResearchResult {
  readonly summary: string;
  readonly artifactId: string;
  readonly evidence: readonly ResearchEvidence[];
  readonly openQuestions: readonly string[];
}

export interface ResearchSearchHit {
  readonly url: string;
  readonly kind: string;
}

export interface ResearchSource {
  readonly url: string;
  readonly kind: string;
  readonly text: string;
}

export interface ResearchDelegateInput {
  readonly question: string;
  readonly allowedSourceKinds: readonly string[];
  /** Search and fetch together. Defaults to 3. */
  readonly maxCalls?: number;
  readonly maxOutputChars: number;
  readonly deadlineMs: number;
  /** Epoch milliseconds. The deadline is measured with this clock and a wall-clock abort. */
  readonly now: () => number;
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly ResearchSearchHit[]>;
  readonly fetchSource: (url: string, signal: AbortSignal) => Promise<ResearchSource>;
}

interface ResearchLimits {
  readonly question: string;
  readonly kinds: ReadonlySet<string>;
  readonly maxCalls: number;
  readonly maxOutputChars: number;
  readonly deadlineMs: number;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function validate(input: ResearchDelegateInput): ResearchLimits {
  const maxCalls = input.maxCalls === undefined ? DEFAULT_MAX_CALLS : input.maxCalls;
  if (!positiveInteger(maxCalls)) {
    throw new InvalidResearchLimitsError('maxCalls must be a positive integer.');
  }
  if (!positiveInteger(input.maxOutputChars)) {
    throw new InvalidResearchLimitsError('maxOutputChars must be a positive integer.');
  }
  if (!positiveInteger(input.deadlineMs)) {
    throw new InvalidResearchLimitsError('deadlineMs must be a positive integer.');
  }
  if (typeof input.question !== 'string' || input.question.trim() === '') {
    throw new InvalidResearchLimitsError('question must be a non-empty string.');
  }
  if (
    !Array.isArray(input.allowedSourceKinds) ||
    input.allowedSourceKinds.length === 0 ||
    input.allowedSourceKinds.some((kind) => typeof kind !== 'string' || kind.trim() === '')
  ) {
    throw new InvalidResearchLimitsError('allowedSourceKinds must list at least one source kind.');
  }
  if (
    typeof input.now !== 'function' ||
    typeof input.search !== 'function' ||
    typeof input.fetchSource !== 'function'
  ) {
    throw new InvalidResearchLimitsError('now, search, and fetchSource must be functions.');
  }
  return {
    question: input.question.trim(),
    kinds: new Set(input.allowedSourceKinds),
    maxCalls,
    maxOutputChars: input.maxOutputChars,
    deadlineMs: input.deadlineMs,
  };
}

function artifactIdFor(question: string): string {
  const digest = createHash('sha256').update(question, 'utf8').digest('hex').slice(0, 16);
  return `research-${digest}`;
}

/** First `EXCERPT_CHARS` of the source, unchanged, so a quote check can find them again. */
function exactExcerpt(text: string): { quote: string; start: number } | null {
  if (text.length === 0) return null;
  return { quote: text.slice(0, EXCERPT_CHARS), start: 0 };
}

class ResearchDeadline extends Error {
  constructor() {
    super('deadline');
    this.name = 'ResearchDeadline';
  }
}

/**
 * Runs `work` with an abort signal. The delegate stops at `remainingMs` even when `work`
 * ignores the signal and never settles.
 */
function callWithin(
  work: (signal: AbortSignal) => Promise<unknown>,
  remainingMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      controller.abort();
      if (settled) return;
      settled = true;
      reject(new ResearchDeadline());
    }, remainingMs);
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };
    work(controller.signal).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) =>
        finish(() => reject(controller.signal.aborted ? new ResearchDeadline() : error)),
    );
  });
}

function summarize(evidence: readonly ResearchEvidence[]): string {
  if (evidence.length === 0) return MISSING_FACT;
  return evidence.map((item) => item.quote).join(' ');
}

function isHit(value: unknown): value is ResearchSearchHit {
  if (typeof value !== 'object' || value === null) return false;
  const hit = value as ResearchSearchHit;
  return typeof hit.url === 'string' && hit.url.length > 0 && typeof hit.kind === 'string';
}

function allowedHits(hits: readonly unknown[], kinds: ReadonlySet<string>): ResearchSearchHit[] {
  const seen = new Set<string>();
  const accepted: ResearchSearchHit[] = [];
  for (const value of hits) {
    if (!isHit(value) || !kinds.has(value.kind) || seen.has(value.url)) continue;
    seen.add(value.url);
    accepted.push({ url: value.url, kind: value.kind });
  }
  return accepted;
}

function payloadLength(
  summary: string,
  artifactId: string,
  evidence: readonly ResearchEvidence[],
  openQuestions: readonly string[],
): number {
  return JSON.stringify({ summary, artifactId, evidence, openQuestions }).length;
}

function fits(
  evidence: readonly ResearchEvidence[],
  artifactId: string,
  maxOutputChars: number,
): boolean {
  return payloadLength(summarize(evidence), artifactId, evidence, []) <= maxOutputChars;
}

function clipSummary(
  items: readonly ResearchEvidence[],
  notes: readonly string[],
  artifactId: string,
  maxOutputChars: number,
): string {
  let summary = summarize(items);
  while (summary.length > 0 && payloadLength(summary, artifactId, items, notes) > maxOutputChars) {
    summary = summary.slice(0, -1);
  }
  return summary;
}

function assemble(
  evidence: readonly ResearchEvidence[],
  cap: CapReason | null,
  artifactId: string,
  maxOutputChars: number,
): ResearchResult {
  let items = [...evidence];
  let notes: string[] = cap === null ? [] : [CAP_QUESTION[cap]];
  let summary = clipSummary(items, notes, artifactId, maxOutputChars);
  while (payloadLength(summary, artifactId, items, notes) > maxOutputChars && items.length > 0) {
    items = items.slice(0, -1);
    summary = clipSummary(items, notes, artifactId, maxOutputChars);
  }
  if (notes.length > 0 && payloadLength(summary, artifactId, items, notes) > maxOutputChars) {
    let note = notes[0] ?? '';
    while (note.length > 0 && payloadLength(summary, artifactId, items, [note]) > maxOutputChars) {
      note = note.slice(0, -1);
    }
    notes = note.length > 0 ? [note] : [];
    summary = clipSummary(items, notes, artifactId, maxOutputChars);
  }
  const result = { summary, artifactId, evidence: items, openQuestions: notes };
  if (payloadLength(summary, artifactId, items, notes) > maxOutputChars) {
    return { summary: '', artifactId, evidence: [], openQuestions: [] };
  }
  return result;
}

async function runBounded(
  input: ResearchDelegateInput,
  limits: ResearchLimits,
): Promise<ResearchResult> {
  const started = input.now();
  if (!Number.isFinite(started)) {
    throw new InvalidResearchLimitsError('now() must return epoch milliseconds.');
  }
  const artifactId = artifactIdFor(limits.question);
  const deadlineAt = started + limits.deadlineMs;
  if (payloadLength('', artifactId, [], []) > limits.maxOutputChars) {
    throw new InvalidResearchLimitsError('maxOutputChars is smaller than the result shell.');
  }
  let calls = 0;
  let cap: CapReason | null = null;
  const evidence: ResearchEvidence[] = [];

  const stopBeforeCall = (): CapReason | null => {
    if (calls >= limits.maxCalls) return 'calls';
    const current = input.now();
    if (!Number.isFinite(current) || current >= deadlineAt) return 'deadline';
    return null;
  };

  const blocked = stopBeforeCall();
  if (blocked) return assemble(evidence, blocked, artifactId, limits.maxOutputChars);

  const take = async <T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | ResearchDeadline> => {
    const current = input.now();
    const remaining = deadlineAt - current;
    if (!Number.isFinite(remaining) || remaining <= 0) return new ResearchDeadline();
    try {
      return (await callWithin(work, remaining)) as T;
    } catch (error) {
      if (error instanceof ResearchDeadline) return error;
      throw error;
    }
  };

  calls += 1;
  const searched = await take((signal) => input.search(limits.question, signal));
  if (searched instanceof ResearchDeadline) {
    return assemble(evidence, 'deadline', artifactId, limits.maxOutputChars);
  }
  const hits = searched;
  if (!Array.isArray(hits)) throw new Error('Search must return a list of hits.');

  for (const hit of allowedHits(hits, limits.kinds)) {
    const stop = stopBeforeCall();
    if (stop) {
      cap = stop;
      break;
    }
    calls += 1;
    const fetched = await take((signal) => input.fetchSource(hit.url, signal));
    if (fetched instanceof ResearchDeadline) {
      cap = 'deadline';
      break;
    }
    const source = fetched;
    if (typeof source?.kind !== 'string' || !limits.kinds.has(source.kind)) continue;
    const passage = exactExcerpt(typeof source.text === 'string' ? source.text : '');
    if (!passage) continue;
    const url = typeof source.url === 'string' && source.url.length > 0 ? source.url : hit.url;
    const next = [...evidence, { url, quote: passage.quote, start: passage.start }];
    if (!fits(next, artifactId, limits.maxOutputChars)) {
      cap = 'output';
      break;
    }
    evidence.push({ url, quote: passage.quote, start: passage.start });
  }

  return assemble(evidence, cap, artifactId, limits.maxOutputChars);
}

/**
 * Answers one question with injected search and fetch. Performs no HTTP.
 * Call, output, and deadline caps are applied here. Depth is one level:
 * a delegate already on the stack throws before it searches.
 */
export async function runResearchDelegate(input: ResearchDelegateInput): Promise<ResearchResult> {
  if ((delegateDepth.getStore() ?? 0) >= 1) throw new NestedResearchDelegateError();
  const limits = validate(input);
  return delegateDepth.run(1, () => runBounded(input, limits));
}
