'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { SlideEditPart } from '@lct/contracts';
import { paragraphsForText } from '@lct/deck-ops';
import { CheckIcon, WarningIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { useAssistantDeck } from '@/components/assistant/deck-context';

const APPLIED_KEY = 'lct.agent-edits.applied';

/** Правки агента, уже записанные в черновик в этом браузере: вторично они не применяются. */
function appliedEdits(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function rememberApplied(editId: string): void {
  try {
    const applied = [...appliedEdits(), editId].slice(-500);
    localStorage.setItem(APPLIED_KEY, JSON.stringify(applied));
  } catch {
    // Без хранилища правка всё равно применена: сессия её помнит через текст на слайде.
  }
}

/** Правки, применённые за эту сессию страницы, пока хранилище недоступно. */
const appliedNow = new Set<string>();

/**
 * Правка текста объекта, которую прислал агент (`edit_slide`). В редакторе этой колоды она
 * пишется в черновик журналом правок один раз — человек видит текст на слайде и отменяет его
 * Ctrl+Z, как свою правку. Если текст на слайде успели изменить, правка ждёт кнопки.
 */
export function SlideEditCard({
  part,
  currentDeckId,
}: {
  part: SlideEditPart;
  /** Колода, открытая в редакторе; вне редактора правку применить некуда. */
  currentDeckId?: string;
}) {
  const t = useTranslations('deckChat.edit');
  const bridge = useAssistantDeck();
  const here = bridge !== null && currentDeckId === part.deckId;
  const slide = here ? bridge.slides[part.slideNumber - 1] : undefined;
  const element = slide?.elements.find((item) => item.elementId === part.elementId);
  const current = useMemo(
    () =>
      element?.kind === 'text'
        ? element.paragraphs.map((p) => p.runs.map((run) => run.text).join('')).join('\n')
        : null,
    [element],
  );

  const write = () => {
    if (!bridge || !slide || element?.kind !== 'text') return;
    bridge.writeText(
      slide.slideId,
      element.elementId,
      paragraphsForText(element.paragraphs, part.text),
    );
    appliedNow.add(part.editId);
    rememberApplied(part.editId);
  };

  const done = current === part.text;
  const fresh =
    current !== null &&
    current === part.before &&
    !appliedNow.has(part.editId) &&
    !appliedEdits().has(part.editId);
  useEffect(() => {
    if (fresh) write();
    // Правка пишется один раз, когда объект ещё говорит то, что видел агент.
  }, [fresh]);

  const state = !here
    ? 'elsewhere'
    : current === null
      ? 'missing'
      : done || fresh
        ? 'applied'
        : 'changed';

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2 text-[0.8125rem]">
      <p className="flex items-center gap-1.5 font-medium">
        {state === 'applied' ? (
          <CheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : state === 'missing' || state === 'changed' ? (
          <WarningIcon aria-hidden className="size-3.5 shrink-0 text-(--project-yellow)" />
        ) : null}
        {t(`title.${state}`, { slide: part.slideNumber })}
      </p>
      <p className="line-clamp-4 whitespace-pre-line text-muted-foreground">{part.text}</p>
      {state === 'applied' ? (
        <p className="text-xs text-muted-foreground">{t('undo')}</p>
      ) : state === 'changed' ? (
        <Button size="sm" variant="outline" className="self-start" onClick={write}>
          {t('apply')}
        </Button>
      ) : null}
    </div>
  );
}
