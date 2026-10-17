'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { OUTLINE_SLIDES, type ChatPart, type DeckOutline } from '@lct/contracts';
import { PaletteStrip } from '@/components/library/template-swatch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DeleteIcon,
  PlusIcon,
  RocketIcon,
  TemplateIcon,
} from '@/components/ui/icons';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

type PlanPart = Extract<ChatPart, { type: 'plan' }>;

/**
 * План презентации, который предложил агент: название, для кого, цель и слайды — тезис, пункты
 * и вид слайда. Пока план ждёт решения, его можно править прямо в карточке: переписать тезис и
 * пункты, переставить, убрать или добавить слайд, выбрать шаблон. «Собрать по плану» отдаёт
 * план сборке таким, каким его оставил человек; «Уточнить» — сказать агенту словами.
 *
 * Заменённый новым или уже собранный план свёрнут: его можно раскрыть и прочитать.
 */
export function PlanCard({
  part,
  templates,
  active,
  busy,
  onApprove,
  onRefine,
  compact = false,
}: {
  part: PlanPart;
  templates: readonly TemplateSummary[];
  /** План ждёт решения человека: его можно править и собрать. */
  active: boolean;
  /** Агент отвечает: собрать пока нельзя. */
  busy: boolean;
  onApprove: (outline: DeckOutline, templateId: string) => void;
  onRefine: () => void;
  compact?: boolean;
}) {
  const t = useTranslations('deckChat.plan');
  const titleId = useId();
  const [draft, setDraft] = useState<DeckOutline>(part.outline);
  const [edited, setEdited] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(
    part.templateId ?? (templates.length === 1 ? (templates[0]?.templateId ?? null) : null),
  );
  const [open, setOpen] = useState(active);
  const outline = active ? draft : part.outline;
  const template = templates.find((item) => item.templateId === templateId) ?? null;
  const expanded = active || open;

  const change = (next: DeckOutline) => {
    setDraft(next);
    setEdited(true);
  };
  const changeSlide = (index: number, patch: Partial<DeckOutline['slides'][number]>) =>
    change({
      ...draft,
      slides: draft.slides.map((slide, at) => (at === index ? { ...slide, ...patch } : slide)),
    });
  const move = (index: number, step: -1 | 1) => {
    const slides = [...draft.slides];
    const [slide] = slides.splice(index, 1);
    if (!slide) return;
    slides.splice(index + step, 0, slide);
    change({ ...draft, slides });
  };

  const status =
    part.status === 'approved'
      ? t('approved')
      : part.status === 'superseded'
        ? t('superseded')
        : null;

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col',
        compact ? 'text-[0.8125rem]' : 'text-sm',
        part.status === 'superseded' && 'opacity-70',
      )}
    >
      <header className={cn('flex items-start gap-2', compact ? 'px-3 pt-3' : 'px-4 pt-4')}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">
            {t('title')} · {t('slides', { count: outline.slides.length })}
            {status ? ` · ${status}` : edited && active ? ` · ${t('edited')}` : ''}
          </p>
          {active ? (
            <input
              id={titleId}
              value={draft.title}
              maxLength={100}
              onChange={(event) => change({ ...draft, title: event.currentTarget.value })}
              className="-mx-1 rounded-md bg-transparent px-1 py-0.5 text-base font-semibold text-foreground outline-none hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          ) : (
            <h3 id={titleId} className="text-base font-semibold text-foreground">
              {outline.title}
            </h3>
          )}
          {outline.audience || outline.goal ? (
            <p className="text-xs text-pretty text-muted-foreground">
              {outline.audience ? `${t('audience')}: ${outline.audience}` : ''}
              {outline.audience && outline.goal ? ' · ' : ''}
              {outline.goal ? `${t('goal')}: ${outline.goal}` : ''}
            </p>
          ) : null}
        </div>
        {active ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label={t('title')}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </Button>
        )}
      </header>

      {expanded ? (
        <ol className={cn('flex flex-col', compact ? 'gap-1 p-3' : 'gap-1.5 p-4')}>
          {outline.slides.map((slide, index) => (
            <li
              key={index}
              className="group/slide flex gap-2.5 rounded-xl px-2 py-1.5 hover:bg-muted/40 focus-within:bg-muted/40"
            >
              <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
                  {t(`kinds.${slide.kind}`)}
                </span>
                {active ? (
                  <>
                    <input
                      value={slide.title}
                      maxLength={160}
                      aria-label={t('titleLabel', { number: index + 1 })}
                      onChange={(event) => changeSlide(index, { title: event.currentTarget.value })}
                      className="-mx-1 rounded-md bg-transparent px-1 font-medium text-foreground outline-none hover:bg-background/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                    <textarea
                      value={slide.points.join('\n')}
                      rows={Math.max(1, slide.points.length)}
                      aria-label={t('pointsLabel', { number: index + 1 })}
                      onChange={(event) =>
                        changeSlide(index, {
                          points: event.currentTarget.value.split('\n').slice(0, 8),
                        })
                      }
                      className="-mx-1 field-sizing-content resize-none rounded-md bg-transparent px-1 text-muted-foreground outline-none hover:bg-background/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{slide.title}</span>
                    {slide.points.length > 0 ? (
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {slide.points.map((point, at) => (
                          <li key={at}>{point}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
              {active ? (
                <div className="flex shrink-0 flex-col opacity-0 group-hover/slide:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('moveUp')}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('moveDown')}
                    disabled={index === outline.slides.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('remove')}
                    title={
                      outline.slides.length <= OUTLINE_SLIDES.min
                        ? t('minSlides', { min: OUTLINE_SLIDES.min })
                        : t('remove')
                    }
                    disabled={outline.slides.length <= OUTLINE_SLIDES.min}
                    onClick={() =>
                      change({ ...draft, slides: draft.slides.filter((_, at) => at !== index) })
                    }
                  >
                    <DeleteIcon />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
          {active && outline.slides.length < OUTLINE_SLIDES.max ? (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-7 text-muted-foreground"
                onClick={() =>
                  change({
                    ...draft,
                    slides: [...draft.slides, { title: t('newSlide'), points: [], kind: 'other' }],
                  })
                }
              >
                <PlusIcon data-icon="inline-start" />
                {t('add')}
              </Button>
            </li>
          ) : null}
        </ol>
      ) : null}

      {active ? (
        <footer
          className={cn(
            'flex flex-wrap items-center gap-2 pt-2',
            compact ? 'px-3 py-2.5' : 'px-4 py-3',
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size={compact ? 'default' : 'lg'}>
                {template ? (
                  <PaletteStrip system={template.designSystem} className="h-2 w-4 rounded-full" />
                ) : (
                  <TemplateIcon data-icon="inline-start" />
                )}
                <span className="max-w-48 truncate">
                  {template ? template.fileName : t('chooseTemplate')}
                </span>
                <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>{t('template')}</DropdownMenuLabel>
              {templates.map((item) => (
                <DropdownMenuItem
                  key={item.templateId}
                  onSelect={() => setTemplateId(item.templateId)}
                >
                  <PaletteStrip
                    system={item.designSystem}
                    className="w-8 shrink-0 ring-1 ring-border"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.fileName}</span>
                  {item.templateId === templateId ? <CheckIcon className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'default' : 'lg'}
            onClick={onRefine}
          >
            {t('refine')}
          </Button>
          <Button
            type="button"
            size={compact ? 'default' : 'lg'}
            disabled={
              busy || templateId === null || draft.slides.some((slide) => !slide.title.trim())
            }
            onClick={() => {
              if (templateId === null) return;
              onApprove(
                {
                  ...draft,
                  title: draft.title.trim() || part.outline.title,
                  slides: draft.slides.map((slide) => ({
                    ...slide,
                    title: slide.title.trim(),
                    points: slide.points.map((point) => point.trim()).filter(Boolean),
                  })),
                },
                templateId,
              );
            }}
          >
            <RocketIcon data-icon="inline-start" />
            {t('approve')}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
