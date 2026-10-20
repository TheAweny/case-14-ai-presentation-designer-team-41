import type { CompositionCritique, DeckOutline, SlotVisual } from '@lct/contracts';
import { sourceBriefTexts } from './source-brief.js';

/** Conservative explicit requests only; mentions in source facts are not requirements. */
export function requestedNativeKinds(text: string): ('chart' | 'table')[] {
  const result = new Set<'chart' | 'table'>();
  for (const sentence of text.split(/[.!?;\n]/u)) {
    if (/(?:\b(?:no|without|avoid|not)\b|(?:^|[^\p{L}])не\s|без\s)/iu.test(sentence)) continue;
    if (
      !/(?:добав[ьи]|включ[ьи]|нуж(?:ен|на|ны)|нужн[оа]|обязательн|постро[йи]|сдела[йт]|покаж[иь]|созда[йт]|\b(?:add|include|require|must|create|show)\b)/iu.test(
        sentence,
      )
    )
      continue;
    if (/(?:график|диаграмм|\bchart\b)/iu.test(sentence)) result.add('chart');
    if (/(?:таблиц|\btable\b)/iu.test(sentence)) result.add('table');
  }
  return [...result];
}

export function missingNativeRequirements(
  brief: string,
  outline: DeckOutline | null | undefined,
  written: readonly { index: number; slide: { visual?: SlotVisual | null } }[],
): CompositionCritique['issues'] {
  const issues: CompositionCritique['issues'] = [];
  const requirements = [
    ...sourceBriefTexts(brief).map((text) => ({ text, slideIndex: undefined })),
    ...(outline?.slides.map((slide, slideIndex) => ({
      text: [slide.title, ...slide.points].join('\n'),
      slideIndex,
    })) ?? []),
  ];
  for (const requirement of requirements)
    for (const kind of requestedNativeKinds(requirement.text)) {
      const slides =
        requirement.slideIndex === undefined
          ? written
          : written.filter((s) => s.index === requirement.slideIndex);
      const present = slides.some(
        ({ slide }) =>
          slide.visual?.kind === kind ||
          (slide.visual?.kind === 'native' && slide.visual.block.kind === kind),
      );
      if (!present)
        issues.push({
          slideIndex: requirement.slideIndex ?? written[0]?.index ?? 0,
          slotId: '',
          category: 'incomplete-text',
          message: `Не выполнено явное требование: нативн${kind === 'chart' ? 'ый график' : 'ая таблица'}. Проверьте данные и наличие достаточного поля в шаблоне.`,
        });
    }
  return issues;
}
