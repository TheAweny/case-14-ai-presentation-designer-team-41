'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AgentIcon,
  ErrorIcon,
  FixIcon,
  SuccessIcon,
  WarningIcon,
  type Icon,
} from '@/components/ui/icons';
import type { SlideElement, SlideIr } from '@lct/contracts';
import type { AuditIssue, AuditLevel } from '@lct/slide-audit';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { textSnippet } from '@/components/editor/inspector/layer-rows';
import { countIssues, isDeckWide } from '@/components/editor/audit/deck-audit';

/** Сообщение находки по проверке и её виду. Незнакомая пара получает общее «Проблема». */
const MESSAGE = {
  'text-overflow:text': 'overflow',
  'element-overlap:content': 'overlap',
  'element-overlap:covered': 'covered',
  'element-overlap:picture-edge': 'pictureEdge',
  'element-overlap:pictures': 'pictures',
  'off-slide:edge': 'edge',
  'off-slide:outside': 'outside',
  'safe-margins:margin': 'margin',
  'placeholder-text:filler': 'filler',
  'placeholder-text:empty': 'empty',
  'contrast:text': 'contrast',
  'font-unavailable:missing': 'font',
} as const;

type MessageKey = (typeof MESSAGE)[keyof typeof MESSAGE] | 'other';

function messageOf(issue: AuditIssue): MessageKey {
  const key = `${issue.checkId}:${issue.kind}`;
  return key in MESSAGE ? MESSAGE[key as keyof typeof MESSAGE] : 'other';
}

type Filter = 'all' | AuditLevel;

export const LEVEL_ICON: Record<AuditLevel, Icon> = { error: ErrorIcon, warning: WarningIcon };

/** Цвет уровня: ошибка — цветом разрушительного действия, предупреждение — жёлтым проекта. */
export const LEVEL_TEXT: Record<AuditLevel, string> = {
  error: 'text-destructive',
  warning: 'text-(--project-yellow)',
};

export interface AuditPanelProps {
  readonly issues: readonly AuditIssue[];
  readonly slides: readonly SlideIr[];
  /** Находка, которую сейчас показывают на холсте. */
  readonly activeIssueId: string | null;
  readonly onOpen: (issue: AuditIssue) => void;
  readonly onHover: (issue: AuditIssue | null) => void;
  /** Исправление без модели; null — у находки его нет. */
  readonly fixOf: (issue: AuditIssue) => (() => void) | null;
  readonly onAskAssistant?: (issue: AuditIssue) => void;
  /** Находки, которые человек пропустил: в свёрнутом разделе внизу, их можно вернуть. */
  readonly ignored: readonly AuditIssue[];
  readonly onIgnore: (issue: AuditIssue) => void;
  readonly onRestore: (issue: AuditIssue) => void;
}

/**
 * Вкладка «Аудит»: находки живого аудита по слайдам, как список проблем в редакторе кода.
 * Щелчок открывает слайд и выделяет объект, наведение подсвечивает его на холсте. Нарочную
 * вещь — фигуру под обрез, слово, срезанное краем, — можно пропустить, как правило линтера.
 */
export function AuditPanel({
  issues,
  slides,
  activeIssueId,
  onOpen,
  onHover,
  fixOf,
  onAskAssistant,
  ignored,
  onIgnore,
  onRestore,
}: AuditPanelProps) {
  const t = useTranslations('auditPanel');
  const roles = useTranslations('selectionBar.roles');
  const [filter, setFilter] = useState<Filter>('all');
  const counts = countIssues(issues);

  const elements = useMemo(() => {
    const byId = new Map<string, SlideElement>();
    for (const slide of slides) {
      for (const element of slide.elements)
        byId.set(`${slide.slideId}:${element.elementId}`, element);
    }
    return byId;
  }, [slides]);
  const slideNumber = useMemo(
    () => new Map(slides.map((slide, index) => [slide.slideId, index + 1])),
    [slides],
  );

  const nameOf = (slideId: string, elementId: string | null | undefined): string => {
    const element = elementId ? elements.get(`${slideId}:${elementId}`) : undefined;
    if (!element) return '';
    return textSnippet(element) ?? roles(element.role);
  };
  const valuesOf = (issue: AuditIssue) => ({
    ...issue.params,
    name: nameOf(issue.slideId, issue.elementId),
    other: nameOf(issue.slideId, issue.relatedIds[0]),
  });

  const skipped =
    ignored.length > 0 ? (
      <details className="group/ignored border-t border-border px-1.5 pt-2">
        <summary className="cursor-pointer list-none rounded-sm px-1.5 py-1 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          {t('ignored', { count: ignored.length })}
        </summary>
        <ul className="flex flex-col pt-1">
          {ignored.map((issue) => {
            const LevelIcon = LEVEL_ICON[issue.level];
            return (
              <li
                key={issue.issueId}
                data-ignored-issue-id={issue.issueId}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
              >
                <LevelIcon size={12} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {t(`issues.${messageOf(issue)}.title`, valuesOf(issue))}
                </span>
                <Button size="xs" variant="ghost" onClick={() => onRestore(issue)}>
                  {t('restore')}
                </Button>
              </li>
            );
          })}
        </ul>
      </details>
    ) : null;

  // Сначала находки про всю колоду, потом по слайдам в порядке показа.
  const groups = useMemo(() => {
    const shown = filter === 'all' ? issues : issues.filter((issue) => issue.level === filter);
    const deck = shown.filter(isDeckWide);
    const bySlide = new Map<string, AuditIssue[]>();
    for (const issue of shown) {
      if (isDeckWide(issue)) continue;
      const list = bySlide.get(issue.slideId) ?? [];
      list.push(issue);
      bySlide.set(issue.slideId, list);
    }
    const slideGroups = [...bySlide].map(([slideId, list]) => ({
      key: slideId,
      heading: t('slide', { number: slideNumber.get(slideId) ?? 0 }),
      list,
    }));
    return deck.length > 0
      ? [{ key: 'deck', heading: t('deck'), list: deck }, ...slideGroups]
      : slideGroups;
  }, [filter, issues, slideNumber, t]);

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <SuccessIcon size={28} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{t('clean')}</p>
        <p className="text-xs text-balance text-muted-foreground">{t('cleanHint')}</p>
        {skipped ? <div className="w-full text-left">{skipped}</div> : null}
      </div>
    );
  }

  return (
    <section aria-label={t('label')} className="flex flex-col gap-2 py-2">
      <p className="px-3 text-xs text-foreground">
        <span className={cn(counts.errors > 0 && 'font-medium')}>
          {t('errors', { count: counts.errors })}
        </span>
        {' · '}
        <span className="text-muted-foreground">{t('warnings', { count: counts.warnings })}</span>
      </p>

      <div role="group" aria-label={t('filters.label')} className="flex gap-1 px-3">
        {(['all', 'error', 'warning'] as const).map((value) => (
          <Button
            key={value}
            size="xs"
            variant={filter === value ? 'secondary' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(
              value === 'all'
                ? 'filters.all'
                : value === 'error'
                  ? 'filters.errors'
                  : 'filters.warnings',
            )}
          </Button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">{t('nothingOfKind')}</p>
      ) : null}

      <div className="flex flex-col gap-3" onMouseLeave={() => onHover(null)}>
        {groups.map(({ key: groupKey, heading, list }) => (
          <div key={groupKey} className="flex flex-col">
            <h3 className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">{heading}</h3>
            <ul className="flex flex-col px-1.5">
              {list.map((issue) => {
                const key = messageOf(issue);
                const values = valuesOf(issue);
                const fix = fixOf(issue);
                const LevelIcon = LEVEL_ICON[issue.level];
                const ask =
                  onAskAssistant && issue.fixability === 'assisted' && issue.elementId
                    ? () => onAskAssistant(issue)
                    : null;
                return (
                  <li
                    key={issue.issueId}
                    data-issue-id={issue.issueId}
                    data-active={issue.issueId === activeIssueId ? '' : undefined}
                    onMouseEnter={() => onHover(issue)}
                    className={cn(
                      'group/issue flex flex-col gap-1 rounded-md px-1.5 py-1.5',
                      'hover:bg-muted data-active:bg-muted',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(issue)}
                      aria-label={`${t(`level.${issue.level}`)}: ${t(`issues.${key}.title`, values)}`}
                      className="flex items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <LevelIcon
                        size={14}
                        className={cn('mt-px shrink-0', LEVEL_TEXT[issue.level])}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground">
                          {t(`issues.${key}.title`, values)}
                        </span>
                        <span className="text-[11px] text-pretty text-muted-foreground">
                          {t(`issues.${key}.detail`, values)}
                        </span>
                      </span>
                    </button>
                    <div className="flex gap-1 pl-5">
                      {fix ? (
                        <Button size="xs" variant="outline" onClick={fix}>
                          <FixIcon />
                          {t('fix')}
                        </Button>
                      ) : null}
                      {ask ? (
                        <Button size="xs" variant="ghost" onClick={ask}>
                          <AgentIcon />
                          {t('askAssistant')}
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => onIgnore(issue)}
                      >
                        {t('ignore')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {skipped}
    </section>
  );
}
