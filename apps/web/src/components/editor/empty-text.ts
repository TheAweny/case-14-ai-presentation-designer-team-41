import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ElementRole, SlideElement } from '@lct/contracts';

type TextElement = Extract<SlideElement, { kind: 'text' }>;

/** Роли, у пустой рамки которых есть подсказка, и ключ подсказки в словаре. */
const PROMPT_KEY = {
  title: 'title',
  subtitle: 'subtitle',
  body: 'body',
  'bullet-list': 'bulletList',
  quote: 'quote',
  'kpi-value': 'kpiValue',
  'kpi-caption': 'kpiCaption',
} as const satisfies Partial<Record<ElementRole, string>>;

function promptKey(role: ElementRole): (typeof PROMPT_KEY)[keyof typeof PROMPT_KEY] | null {
  return role in PROMPT_KEY ? PROMPT_KEY[role as keyof typeof PROMPT_KEY] : null;
}

/**
 * Подсказка в пустой рамке макета — «Заголовок», «Текст», — как в PowerPoint и Google Slides:
 * видно, куда и что писать. Только у рамок из шаблона (`sourceShapeId`): пустой текст, который
 * нарисовал сам человек, на слайде не остаётся. На слайд подсказка не попадает — её рисует только
 * редактор, в показе и экспорте её нет.
 */
export function useEmptyTextPrompt(): (element: TextElement) => string | null {
  const t = useTranslations('editor.emptyText');
  return useCallback(
    (element: TextElement) => {
      if (element.sourceShapeId === null) return null;
      const key = promptKey(element.role);
      return key ? t(key) : null;
    },
    [t],
  );
}
