import type { AssistantChatMessage, ChatPart, ChatToolActivity } from '@lct/contracts';

export type ToolPart = Extract<ChatPart, { type: 'tool' }>;
export type ToolVisualState = 'preparing' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ToolChipView {
  readonly callId: string;
  readonly name: string;
  readonly detail: string | null;
  readonly fullDetail: string | null;
  readonly state: ToolVisualState;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly error: string | null;
  readonly activities: readonly ActivityChipView[];
  readonly waiting: boolean;
  /** Nested steps that failed or were cancelled. The parent call itself stays done. */
  readonly issues: number;
}

export interface ActivityChipView {
  readonly id: string;
  readonly kind: 'agent' | 'tool';
  readonly name: string;
  readonly detail: string | null;
  readonly fullDetail: string | null;
  readonly state: Exclude<ToolVisualState, 'preparing'>;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly error: string | null;
  readonly children: readonly ActivityChipView[];
}

const READ_TOOLS = [
  'list_templates',
  'describe_template',
  'read_file',
  'research_materials',
  'read_deck',
  'read_audit',
  'search_materials',
  'inspect_template_layout',
  'preview_slide',
  'check_slide_fit',
  'check_content_coverage',
  'search_web',
  'fetch_source',
  'research_topic',
  'calculate',
  'extract_material',
  'read_table',
  'inspect_sources',
  'search_assets',
  'read_build_status',
] as const;

export type ReadTool = (typeof READ_TOOLS)[number];
const CARD_TOOLS = ['ask_user', 'propose_plan', 'build_deck', 'edit_slide'] as const;
export type CardTool = (typeof CARD_TOOLS)[number];

const MAX_ACTIVITIES = 32;
const CHIP_DETAIL = 72;
const ERROR_DETAIL = 180;
const SECRET_QUERY =
  /^(?:access[_-]?token|api[_-]?key|auth|key|password|secret|sig|signature|token)$/i;

export function isReadTool(name: string): name is ReadTool {
  return (READ_TOOLS as readonly string[]).includes(name);
}

export function isCardTool(name: string): name is CardTool {
  return (CARD_TOOLS as readonly string[]).includes(name);
}

export function toolLineVisible(
  part: ToolPart,
  cardCallIds: ReadonlySet<string>,
  messageStatus: AssistantChatMessage['status'],
): boolean {
  const state = toolState(part, messageStatus);
  if (state === 'failed' || state === 'cancelled') return true;
  if (!isCardTool(part.name) || part.name === 'build_deck') return true;
  return !cardCallIds.has(part.callId) && part.status === 'running';
}

export function toolState(
  part: ToolPart,
  messageStatus: AssistantChatMessage['status'],
): ToolVisualState {
  if (part.status === 'running' && messageStatus !== 'streaming') {
    return messageStatus === 'failed' ? 'failed' : 'cancelled';
  }
  if (part.status === 'running' && part.phase === 'preparing') return 'preparing';
  return part.status;
}

export function activityState(
  activity: ChatToolActivity,
  messageStatus: AssistantChatMessage['status'],
): ActivityChipView['state'] {
  if (activity.status === 'running' && messageStatus !== 'streaming') {
    return messageStatus === 'failed' ? 'failed' : 'cancelled';
  }
  return activity.status;
}

export function activeAgentCount(
  parts: readonly ToolPart[],
  messageStatus: AssistantChatMessage['status'],
): number {
  if (messageStatus !== 'streaming') return 0;
  let count = 0;
  for (const part of parts) {
    if (part.status !== 'running') continue;
    for (const activity of boundedActivities(part.activities)) {
      if (activity.kind === 'agent' && activityState(activity, messageStatus) === 'running') {
        count += 1;
      }
    }
  }
  return count;
}

export const activeResearcherCount = activeAgentCount;

export function toolChip(
  part: ToolPart,
  messageStatus: AssistantChatMessage['status'],
): ToolChipView {
  const state = toolState(part, messageStatus);
  const detail = toolDetail(part.name, part.input);
  const activities = activityTree(boundedActivities(part.activities), messageStatus);
  return {
    callId: part.callId,
    name: part.name,
    detail: detail?.short ?? null,
    fullDetail: detail?.full ?? null,
    state,
    startedAt: numberOrNull(part.startedAt),
    finishedAt: numberOrNull(part.finishedAt),
    error: state === 'failed' ? firstText(partError(part), ERROR_DETAIL) : null,
    activities,
    waiting: (state === 'running' || state === 'preparing') && !activities.some(containsRunning),
    issues: countIssues(activities),
  };
}

export function groupState(
  chips: readonly ToolChipView[],
): 'running' | 'done' | 'failed' | 'cancelled' {
  if (chips.some((chip) => chip.state === 'running' || chip.state === 'preparing'))
    return 'running';
  if (chips.some((chip) => chip.state === 'failed')) return 'failed';
  if (chips.some((chip) => chip.state === 'cancelled')) return 'cancelled';
  if (chips.some((chip) => chip.issues > 0)) return 'failed';
  return 'done';
}

export function durationMs(
  startedAt: number | null,
  finishedAt: number | null,
  now: number,
): number | null {
  if (startedAt === null || startedAt < 0) return null;
  const end = finishedAt ?? now;
  if (!Number.isFinite(end) || end < startedAt) return null;
  return end - startedAt;
}

export function boundedActivities(
  activities: readonly ChatToolActivity[] | undefined,
  messageOpen = true,
): ChatToolActivity[] {
  const list = activities ?? [];
  if (list.length <= MAX_ACTIVITIES) return [...list];
  const live = messageOpen ? list.filter((activity) => activity.status === 'running') : [];
  const liveIds = new Set(live.map((activity) => activity.id));
  const finished = list.filter((activity) => !liveIds.has(activity.id));
  return [...finished.slice(-(MAX_ACTIVITIES - live.length)), ...live].slice(-MAX_ACTIVITIES);
}

function containsRunning(activity: ActivityChipView): boolean {
  return activity.state === 'running' || activity.children.some(containsRunning);
}

function countIssues(activities: readonly ActivityChipView[]): number {
  return activities.reduce(
    (count, activity) =>
      count +
      (activity.state === 'failed' || activity.state === 'cancelled' ? 1 : 0) +
      countIssues(activity.children),
    0,
  );
}

function activityTree(
  activities: readonly ChatToolActivity[],
  messageStatus: AssistantChatMessage['status'],
): ActivityChipView[] {
  const byParent = new Map<string, ChatToolActivity[]>();
  const roots: ChatToolActivity[] = [];
  const ids = new Set(activities.map((activity) => activity.id));
  for (const activity of activities) {
    const parent = activity.parentId;
    if (parent && parent !== activity.id && ids.has(parent)) {
      const children = byParent.get(parent) ?? [];
      children.push(activity);
      byParent.set(parent, children);
    } else roots.push(activity);
  }
  if (roots.length === 0 && activities.length > 0) {
    const first = activities[0];
    if (first) roots.push(first);
  }
  const visit = (activity: ChatToolActivity, trail: ReadonlySet<string>): ActivityChipView => {
    const children = trail.has(activity.id)
      ? []
      : (byParent.get(activity.id) ?? []).map((child) =>
          visit(child, new Set(trail).add(activity.id)),
        );
    const detail = activityDetail(activity);
    const state = activityState(activity, messageStatus);
    return {
      id: activity.id,
      kind: activity.kind,
      name: activity.name,
      detail: detail?.short ?? null,
      fullDetail: detail?.full ?? null,
      state,
      startedAt: activity.startedAt,
      finishedAt: numberOrNull(activity.finishedAt),
      error: state === 'failed' ? firstText(activity.error, ERROR_DETAIL) : null,
      children,
    };
  };
  return roots.map((activity) => visit(activity, new Set()));
}

function activityDetail(activity: ChatToolActivity): { short: string; full: string } | null {
  if (activity.name === 'fetch_source' && typeof activity.detail === 'string') {
    const url = publicUrl(activity.detail);
    return url === null ? null : textDetail(url);
  }
  return toolDetail(activity.name, activity.detail) ?? safeDetail(activity);
}

function safeDetail(activity: ChatToolActivity): { short: string; full: string } | null {
  if (activity.name === 'fetch_source') return null;
  return textDetail(activity.detail);
}

function toolDetail(name: string, input: unknown): { short: string; full: string } | null {
  const record = recordOf(input);
  if (!record) return typeof input === 'string' && isReadTool(name) ? textDetail(input) : null;
  const raw = publicField(name, record);
  return raw === null ? null : textDetail(raw);
}

function publicField(name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case 'search_web':
    case 'search_assets':
    case 'search_materials':
      return text(input.query);
    case 'fetch_source':
      return input.url === undefined ? null : publicUrl(input.url);
    case 'research_topic':
    case 'research_materials':
    case 'ask_user':
      return text(input.question);
    case 'calculate':
      return text(input.operation);
    case 'read_file':
    case 'extract_material':
    case 'read_table':
    case 'describe_template':
    case 'inspect_template_layout':
      return text(input.name) ?? text(input.fileName) ?? text(input.patternId);
    case 'preview_slide':
    case 'check_slide_fit':
    case 'check_content_coverage':
    case 'edit_slide':
      return slideLabel(input.slideIndex ?? input.slideNumber);
    case 'read_deck':
    case 'read_audit':
      return text(input.deckName) ?? text(input.name);
    case 'read_build_status':
    case 'build_deck':
      return text(input.templateName);
    case 'propose_plan':
      return outlineTitle(input.outline);
    default:
      return null;
  }
}

function slideLabel(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? '#' + String(value)
    : null;
}

function outlineTitle(value: unknown): string | null {
  const outline = recordOf(value);
  return outline ? text(outline.title) : null;
}

function textDetail(value: unknown): { short: string; full: string } | null {
  const full = text(value);
  return full ? { short: clip(full, CHIP_DETAIL), full } : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1).trimEnd() + '\u2026';
}

function firstText(value: unknown, max: number): string | null {
  const clean = text(value);
  return clean === null ? null : clip(clean, max);
}

export function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.protocol === 'file:') return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (privateHost(url.hostname)) return null;
  const kept = new URLSearchParams();
  for (const [key, item] of url.searchParams) {
    if (!SECRET_QUERY.test(key)) kept.append(key, item);
  }
  url.search = kept.toString();
  url.hash = '';
  return url.toString();
}

function privateHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::'
  ) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return match !== null && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function partError(part: ToolPart): unknown {
  const output = recordOf(part.output);
  return output?.error ?? output?.message ?? null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
