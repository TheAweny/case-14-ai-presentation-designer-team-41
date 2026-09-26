'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { IconSvgElement } from '@hugeicons/react';
import {
  ChartColumnIcon,
  DashedLine01Icon,
  EllipseIcon,
  GridTableIcon,
  GroupItemsIcon,
  Image01Icon,
  Layers01Icon,
  ShapesIcon,
  SlideIcon,
  SquareIcon,
  TextIcon,
} from '@hugeicons/core-free-icons';
import type { RefSubject } from '@/lib/slide-context';

/** Иконка ссылки по типу: слайд, объект своего вида, группа или несколько объектов. */
export function refIcon(subject: RefSubject): IconSvgElement {
  switch (subject.kind) {
    case 'slide':
      return SlideIcon;
    case 'group':
      return GroupItemsIcon;
    case 'many':
      return Layers01Icon;
    case 'element':
      switch (subject.elementKind) {
        case 'text':
          return TextIcon;
        case 'image':
          return Image01Icon;
        case 'table':
          return GridTableIcon;
        case 'chart':
          return ChartColumnIcon;
        case 'decor':
          if (subject.shape === 'line') return DashedLine01Icon;
          if (subject.shape === 'ellipse') return EllipseIcon;
          if (subject.shape === 'rect' || subject.shape === 'round-rect') return SquareIcon;
          return ShapesIcon;
      }
  }
}

/**
 * Подписи ссылок на объекты слайда на языке интерфейса. Роль объекта подписывается так же, как
 * в полосе у выделения и в панели слоёв: «Заголовок», «Изображение», форма у фигуры
 * оформления.
 */
export function useSlideRefLabels() {
  const t = useTranslations('assistant.context');
  const roles = useTranslations('selectionBar.roles');
  const shapes = useTranslations('designPanel.shapes');
  const locale = useLocale();

  /** Что это, без слайда: «Заголовок», «3 объекта», «Группа». Для слайда целиком — null. */
  const what = useCallback(
    (subject: RefSubject): string | null => {
      switch (subject.kind) {
        case 'slide':
          return null;
        case 'group':
          return t('group');
        case 'many':
          return t('many', { count: subject.count });
        case 'element':
          if (subject.elementKind === 'decor' && subject.role === 'decoration') {
            if (subject.shape === 'line') return t('line');
            return subject.shape ? shapes(subject.shape) : t('shape');
          }
          return roles(subject.role);
      }
    },
    [roles, shapes, t],
  );

  /** Подпись чипа: «Заголовок · слайд 3», «Слайд 4». */
  const label = useCallback(
    (subject: RefSubject, slideNumber: number): string => {
      const name = what(subject);
      return name === null
        ? t('slide', { number: slideNumber })
        : t('onSlide', { what: name, number: slideNumber });
    },
    [t, what],
  );

  /** Упоминание посреди фразы агента: «заголовок на слайде 3», «слайд 4». */
  const mention = useCallback(
    (subject: RefSubject, slideNumber: number): string => {
      const name = what(subject);
      return name === null
        ? t('mentionSlide', { number: slideNumber })
        : t('mentionOnSlide', { what: name.toLocaleLowerCase(locale), number: slideNumber });
    },
    [locale, t, what],
  );

  return { label, mention };
}
