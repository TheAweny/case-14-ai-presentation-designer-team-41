import type { ChatToolActivity } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';

/**
 * Tool context plus the optional activity callback. The pipeline may type this field later;
 * until then the structural callback is enough.
 */
export type ActivityContext = ToolContext & {
  readonly activity?: (activity: ChatToolActivity) => void;
};

const MAX_DETAIL = 1000;
function foldControls(value: string): string {
  let folded = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    folded += code < 32 || code === 127 ? ' ' : char;
  }
  return folded;
}

/**
 * Detail for a chip. A question is the text the tool was explicitly given.
 * Folding control characters only keeps that text on one line; it does not remove secrets.
 * A URL keeps scheme, host and path. Username, password, query and hash are dropped.
 * Anything that is not an http(s) URL becomes an empty string, which the caller omits.
 */
export function activityDetail(value: string, shape: 'question' | 'url'): string {
  if (shape === 'url') return publicUrl(value);
  const text = foldControls(value).trim();
  return text.length <= MAX_DETAIL ? text : text.slice(0, MAX_DETAIL);
}

function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const text = url.toString();
    return text.length <= MAX_DETAIL ? text : text.slice(0, MAX_DETAIL);
  } catch {
    return '';
  }
}

/** Neutral telemetry code. Raw error text can carry keys, URLs and response bodies. */
function activityCode(error: unknown, signal: AbortSignal): 'cancelled' | 'operation_failed' {
  if (signal.aborted) return 'cancelled';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error as { kind?: unknown }).kind === 'aborted'
  ) {
    return 'cancelled';
  }
  return 'operation_failed';
}

function reportActivity(context: ActivityContext, activity: ChatToolActivity): void {
  try {
    context.activity?.(activity);
  } catch {
    // A telemetry fault must not fail a tool that already finished its work.
  }
}

/**
 * Report one real callback: running, then done, failed, or cancelled.
 * Nothing is reported when the turn is already aborted. A missing callback is a no-op.
 */
export async function withToolActivity<T>(
  context: ActivityContext,
  activity: {
    readonly kind: ChatToolActivity['kind'];
    readonly name: string;
    readonly detail?: string;
    readonly parentId?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  context.signal.throwIfAborted();
  const startedAt = Date.now();
  const detail = activity.detail?.trim();
  const parentId =
    activity.parentId && activity.parentId.length <= 100 ? activity.parentId : undefined;
  const name = activity.name.slice(0, 100);
  const base = {
    id: crypto.randomUUID(),
    kind: activity.kind,
    name,
    ...(parentId ? { parentId } : {}),
    ...(detail ? { detail: detail.slice(0, MAX_DETAIL) } : {}),
  };
  reportActivity(context, { ...base, status: 'running', startedAt });
  try {
    const value = await fn();
    context.signal.throwIfAborted();
    reportActivity(context, { ...base, status: 'done', startedAt, finishedAt: Date.now() });
    return value;
  } catch (error) {
    const code = activityCode(error, context.signal);
    reportActivity(context, {
      ...base,
      status: code === 'cancelled' ? 'cancelled' : 'failed',
      startedAt,
      finishedAt: Date.now(),
      error: code,
    });
    throw error;
  }
}
