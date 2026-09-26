import type { SlideElement, SlideIr } from '@lct/contracts';
import { issue } from '../issue.js';
import { profileOf } from '../profile.js';
import { isBlank, textOf } from '../text.js';
import type { AuditContext, AuditIssue } from '../types.js';

/** Every word an element shows, whatever kind it is. */
function wordsOf(element: SlideElement): string {
  switch (element.kind) {
    case 'text':
      return textOf(element.paragraphs);
    case 'decor':
      return element.paragraphs ? textOf(element.paragraphs) : '';
    case 'table':
      return [...element.headers, ...element.rows.flat()].join('\n');
    case 'chart':
      return [element.xTitle, element.yTitle, ...element.series.map((s) => s.name)].join('\n');
    case 'image':
      return '';
  }
}

/**
 * Filler that must never reach a reader, and text boxes left empty. An empty box shows its prompt
 * in the editor and nothing at all in a slide show, so the slide looks unfinished either way.
 */
export function checkPlaceholderText(slide: SlideIr, context: AuditContext): AuditIssue[] {
  const patterns = profileOf(context.profile)
    .forbiddenPatterns.map((pattern) => pattern.trim().toLocaleLowerCase())
    .filter((pattern) => pattern !== '');
  const issues: AuditIssue[] = [];

  for (const element of slide.elements) {
    const base = { slideId: slide.slideId, elementId: element.elementId, box: element.box };
    if (element.kind === 'text' && isBlank(element.paragraphs)) {
      issues.push(
        issue({
          ...base,
          checkId: 'placeholder-text',
          kind: 'empty',
          level: 'warning',
          fix: [{ op: 'remove', elementId: element.elementId }],
          fixability: 'auto',
        }),
      );
      continue;
    }
    const words = wordsOf(element).toLocaleLowerCase();
    const found = patterns.find((pattern) => words.includes(pattern));
    if (found === undefined) continue;
    issues.push(
      issue({
        ...base,
        checkId: 'placeholder-text',
        kind: 'filler',
        level: 'error',
        params: { pattern: found },
        fixability: 'assisted',
      }),
    );
  }
  return issues;
}
