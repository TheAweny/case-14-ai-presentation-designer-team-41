import { describe, expect, it } from 'vitest';
import { requestedNativeKinds, missingNativeRequirements } from './native-requirements.js';

describe('explicit native visual requirements', () => {
  it('finds required kinds without treating source mentions or negative requests as commands', () => {
    expect(requestedNativeKinds('Добавь график и таблицу.')).toEqual(['chart', 'table']);
    expect(requestedNativeKinds('Не добавляй график. Без таблицы. В отчёте есть график.')).toEqual(
      [],
    );
    expect(requestedNativeKinds('Do not include a chart. Include a table.')).toEqual(['table']);
    expect(requestedNativeKinds('Не включай таблицу.')).toEqual([]);
  });
  it('reports required visuals missing from the actual deck', () => {
    expect(
      missingNativeRequirements(
        JSON.stringify({ userRequirements: [{ messageId: 'u', text: 'Добавь график.' }] }),
        null,
        [],
      ),
    ).toHaveLength(1);
    expect(
      missingNativeRequirements('Добавь график и таблицу.', null, [
        { index: 0, slide: { visual: null } },
      ]),
    ).toHaveLength(2);
  });
  it('accepts actual native blocks and does not require unrequested visuals', () => {
    expect(
      missingNativeRequirements('Добавь таблицу.', null, [
        {
          index: 0,
          slide: {
            visual: {
              kind: 'native',
              slotId: 'body',
              block: { kind: 'table', columns: ['Year'], rows: [['2026']] },
            } as never,
          },
        },
      ]),
    ).toEqual([]);
    expect(missingNativeRequirements('Без графиков.', null, [{ index: 0, slide: {} }])).toEqual([]);
    expect(
      missingNativeRequirements(JSON.stringify({ derivedModelBrief: 'Добавь график.' }), null, []),
    ).toEqual([]);
    expect(
      missingNativeRequirements(JSON.stringify({ userRequirements: 'Добавь график.' }), null, []),
    ).toHaveLength(1);
    expect(
      missingNativeRequirements('Добавь график.', null, [
        { index: 0, slide: { visual: { kind: 'chart' } as never } },
      ]),
    ).toEqual([]);
  });
});
