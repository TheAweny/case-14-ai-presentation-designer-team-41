/**
 * Samples of a template that are only a figure or a period label («05», «2,4%», «III кв.», «Июл»)
 * mean nothing without the facts they stood for. A writer asked to keep the form of the sample
 * keeps the sample too, and it reads on the new slide as a fact of the deck. The figure checks do
 * not see it: numbering like 01, a year and a quarter label are not figures of the brief to them.
 *
 * The engine takes the same view when it exports (`figure_sample` in `engine.export.compositions`):
 * a slot of this kind left empty is removed with its shape. The two cannot share code, so the
 * examples of both tests are the same.
 */

const PERIOD_WORD = new RegExp(
  '^(?:[ivx]{1,4}|q[1-4]|h[12]|кв|квартал\\p{L}*|г|гг|год\\p{L}*|лет|мес|месяц\\p{L}*|млн|млрд|' +
    'тыс|руб|₽|янв\\p{L}*|фев\\p{L}*|мар\\p{L}*|апр\\p{L}*|ма[йя]|июн\\p{L}*|июл\\p{L}*|' +
    'авг\\p{L}*|сен\\p{L}*|окт\\p{L}*|ноя\\p{L}*|дек\\p{L}*|jan\\p{L}*|feb\\p{L}*|mar\\p{L}*|' +
    'apr\\p{L}*|may|jun\\p{L}*|jul\\p{L}*|aug\\p{L}*|sep\\p{L}*|oct\\p{L}*|nov\\p{L}*|dec\\p{L}*|' +
    'usd|eur|rub|%)$',
  'iu',
);
/** Units that are no figure on their own: «млн» says what a number counts, not which. */
const UNIT_WORDS = new Set(['кв', 'г', 'гг', 'лет', 'мес', 'млн', 'млрд', 'тыс', 'руб', '₽', '%']);
const EDGE = /^[.,;:()/\-–—]+|[.,;:()/\-–—]+$/gu;

/** Whether a template sample is only a figure or a period label. */
export function isFigureSample(sample: string): boolean {
  const tokens = sample
    .split(/\s+/)
    .map((word) => word.replace(EDGE, ''))
    .filter(Boolean);
  let figure = false;
  for (const token of tokens) {
    if (/\d/u.test(token)) figure = true;
    else if (PERIOD_WORD.test(token)) figure ||= !UNIT_WORDS.has(token.toLowerCase());
    else return false;
  }
  return figure;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the brief itself states the sample, as a whole token and not as a part of a number. */
export function briefStates(brief: string, sample: string): boolean {
  const words = squash(sample).split(' ').map(escape).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\d])${words}(?![\\p{L}\\d])`, 'iu').test(brief);
}

export interface SampleSlot {
  readonly slotId: string;
  readonly role: string;
  readonly sample: string;
}

export interface SampleSlide {
  readonly index: number;
  readonly composition: { readonly slots: readonly SampleSlot[] };
  readonly slide: { readonly texts: readonly { readonly slotId: string; readonly text: string }[] };
}

/**
 * Slots that still say what the template's sample said, a figure or a period label the brief does
 * not state. They have no fact behind them: the caller empties them, and the engine takes the
 * empty shape off the slide. A title is the writer's, and a sample the brief states is a fact.
 */
export function leakedSamples(
  slides: readonly SampleSlide[],
  brief: string,
): { index: number; slotId: string; sample: string }[] {
  const leaked: { index: number; slotId: string; sample: string }[] = [];
  for (const { index, composition, slide } of slides) {
    for (const slot of composition.slots) {
      if (slot.role === 'title' || !isFigureSample(slot.sample)) continue;
      const text = slide.texts.find((t) => t.slotId === slot.slotId)?.text ?? '';
      if (squash(text) !== squash(slot.sample)) continue;
      if (briefStates(brief, slot.sample)) continue;
      leaked.push({ index, slotId: slot.slotId, sample: slot.sample.trim() });
    }
  }
  return leaked;
}
