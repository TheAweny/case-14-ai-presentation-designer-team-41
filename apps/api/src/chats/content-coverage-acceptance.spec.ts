import { describe, expect, it } from 'vitest';
import { checkContentCoverage } from './content-coverage.js';

const slide = (text: string) => ({
  patternId: 'unfamiliar',
  texts: [{ slotId: 'body', text }],
  speakerNotes: '',
});

describe('independent numeric coverage acceptance', () => {
  it.each(['25.5', '25,5', '-25', '25 000', '125'])(
    'does not turn %s into the exact number 25',
    (actual) => {
      expect(checkContentCoverage(['25'], slide(actual)).status).toBe('requires-review');
    },
  );

  it('accepts the actual integer with punctuation and preserves visible evidence', () => {
    const result = checkContentCoverage(['25'], slide('Группа: 25; принято.'));
    expect(result.status).toBe('covered');
    expect(result.items[0]?.evidence).toBe('25');
  });

  it('does not fabricate evidence after Unicode case expansion', () => {
    const result = checkContentCoverage(['i'], slide('İ'));
    for (const item of result.items) {
      if (item.evidence !== undefined) expect('İ').toContain(item.evidence);
    }
  });
});
