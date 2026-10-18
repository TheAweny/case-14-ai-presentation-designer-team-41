import type { ComposedSlide, Composition } from '@lct/contracts';

/**
 * Repeats across a deck that a reader sees as the same slide again: a figure of the brief stated
 * on several slides, a title that says the deck title or another slide's title again. Each slide
 * is written on its own, so only a pass over the whole deck can see them. The findings go to the
 * repair like the critic's, one per slot.
 */

export interface DeckSlide {
  readonly index: number;
  /** The claim the plan gave the slide; empty when unknown. */
  readonly purpose: string;
  readonly slide: ComposedSlide;
  readonly composition: Composition;
}

export interface RepeatFinding {
  readonly slideIndex: number;
  readonly slotId: string;
  readonly category: 'duplicate-text';
  readonly message: string;
}

/**
 * Figures a listener tells slides apart by: a percentage, or a number of two digits or more that
 * is not a year. Small counts ("from 6 to 2 minutes", "3 steps") repeat naturally and are left out.
 */
export function figuresOf(text: string): Set<string> {
  const found = new Set<string>();
  // Thousands are grouped by a space or a no-break space, never by a line break.
  for (const match of text.matchAll(/(?<![\d.,])\d+(?:[^\S\n]\d{3})*(?:[.,]\d+)?(?!\d)(\s?%)?/g)) {
    const digits = match[0].replace(/[\s%]/g, '').replace(',', '.');
    if (match[1]) {
      found.add(`${digits}%`);
      continue;
    }
    if (digits.replace('.', '').length < 2 || /^(19|20)\d\d$/.test(digits)) continue;
    found.add(digits);
  }
  return found;
}

/** Words of a phrase cut to a crude stem, so «пилот» and «пилота» count as one word. */
function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^\p{L}\p{N}%]+/u)
      .filter((word) => word.length > 2)
      .map((word) => word.slice(0, 5)),
  );
}

function shared(a: Set<string>, b: Set<string>): number {
  return [...a].filter((word) => b.has(word)).length;
}

/** Dice coefficient of two phrases: 1 is the same words. */
function likeness(a: string, b: string): number {
  const left = stems(a);
  const right = stems(b);
  return left.size + right.size ? (2 * shared(left, right)) / (left.size + right.size) : 0;
}

/** How much of the shorter phrase the longer one says too. */
function containment(a: string, b: string): number {
  const left = stems(a);
  const right = stems(b);
  const smaller = Math.min(left.size, right.size);
  return smaller >= 2 ? shared(left, right) / smaller : 0;
}

/** The slide's headline: its title slot with the largest type. */
export function headlineSlot(composition: Composition): string | undefined {
  return [...composition.slots]
    .filter((slot) => slot.role === 'title')
    .sort((a, b) => b.fontSize - a.fontSize)[0]?.slotId;
}

const TITLE_REPEATS_DECK = 0.7;
const TITLE_REPEATS_SLIDE = 0.8;

export function deckRepeats(
  deckTitle: string,
  slides: readonly DeckSlide[],
  brief: string,
): RepeatFinding[] {
  const ordered = [...slides].sort((a, b) => a.index - b.index);
  if (ordered.length < 3) return [];
  const first = ordered[0]?.index;
  const last = ordered[ordered.length - 1]?.index;
  // The cover opens and the closing sums up: both may name what the other slides say.
  const framing = (index: number) => index === first || index === last;
  const findings: RepeatFinding[] = [];
  const stated = figuresOf(brief);
  const textOf = (slide: DeckSlide, slotId: string) =>
    slide.slide.texts.find((t) => t.slotId === slotId)?.text ?? '';

  // A figure belongs to the first slide the plan gave it to, or else to the first slide that
  // states it; any other slide that states it again repeats that slide.
  const owner = new Map<string, number>();
  for (const figure of stated) {
    const planned = ordered.find((s) => !framing(s.index) && figuresOf(s.purpose).has(figure));
    const shown = ordered.find(
      (s) =>
        !framing(s.index) &&
        s.slide.texts.some(
          (t) => t.slotId !== s.slide.visual?.slotId && figuresOf(t.text).has(figure),
        ),
    );
    const index = planned?.index ?? shown?.index;
    if (index !== undefined) owner.set(figure, index);
  }

  const titles: { index: number; text: string }[] = [];
  for (const slide of ordered) {
    if (framing(slide.index)) continue;
    const own = figuresOf(slide.purpose);
    const about = slide.purpose ? ` This slide is about: ${slide.purpose}` : '';
    for (const text of slide.slide.texts) {
      if (!text.text.trim() || text.slotId === slide.slide.visual?.slotId) continue;
      const foreign = [...figuresOf(text.text)].filter((figure) => {
        const at = owner.get(figure);
        return at !== undefined && at !== slide.index && !own.has(figure);
      });
      if (!foreign.length) continue;
      findings.push({
        slideIndex: slide.index,
        slotId: text.slotId,
        category: 'duplicate-text',
        message:
          `${foreign.map((f) => `"${f}"`).join(', ')} already stated on slide ` +
          `${[...new Set(foreign.map((f) => (owner.get(f) ?? 0) + 1))].join(', ')}. ` +
          `Write a point of this slide without that figure.${about}`,
      });
    }
    const headline = headlineSlot(slide.composition);
    const title = headline ? textOf(slide, headline) : '';
    if (!headline || !title.trim()) continue;
    const twin = titles.find((t) => containment(t.text, title) >= TITLE_REPEATS_SLIDE);
    if (likeness(deckTitle, title) >= TITLE_REPEATS_DECK || twin) {
      findings.push({
        slideIndex: slide.index,
        slotId: headline,
        category: 'duplicate-text',
        message:
          (twin
            ? `The title repeats the title of slide ${twin.index + 1}.`
            : 'The title repeats the title of the deck.') +
          ` Write the claim of this slide itself.${about}`,
      });
    }
    titles.push({ index: slide.index, text: title });
  }
  return findings;
}

/** Dates and times a slot may carry: their parts are not figures of the brief. */
const DATE_OR_TIME = /\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}:\d{2}/g;

/** Figures of one text, without dates, times and numbering like 01. */
function statedFigures(text: string): Set<string> {
  return new Set(
    [...figuresOf(text.replace(DATE_OR_TIME, ' '))].filter((figure) => !/^0\d/.test(figure)),
  );
}

/**
 * Figures within one slide: a figure the source does not state, and a figure said again in a
 * second body slot of the same slide. The headline may repeat the figure of one body slot: that
 * is the claim and its proof, anything more is the same line twice.
 */
export function slideFigureDefects(
  slides: readonly DeckSlide[],
  brief: string,
): (Omit<RepeatFinding, 'category'> & { category: 'duplicate-text' | 'factual-error' })[] {
  const source = figuresOf(brief);
  const findings: (Omit<RepeatFinding, 'category'> & {
    category: 'duplicate-text' | 'factual-error';
  })[] = [];
  for (const slide of slides) {
    const headline = headlineSlot(slide.composition);
    const said = new Map<string, string>();
    for (const text of slide.slide.texts) {
      if (!text.text.trim() || text.slotId === slide.slide.visual?.slotId) continue;
      const figures = [...statedFigures(text.text)];
      const unsourced = figures.filter((figure) => !source.has(figure));
      if (unsourced.length) {
        findings.push({
          slideIndex: slide.index,
          slotId: text.slotId,
          category: 'factual-error',
          message:
            `${unsourced.map((f) => `"${f}"`).join(', ')} is not in the source material. ` +
            'Remove it or use a figure the brief states; do not compute or round figures.',
        });
        continue;
      }
      if (text.slotId === headline) continue;
      const again = figures.filter((figure) => said.has(figure));
      if (again.length) {
        findings.push({
          slideIndex: slide.index,
          slotId: text.slotId,
          category: 'duplicate-text',
          message:
            `${again.map((f) => `"${f}"`).join(', ')} is already in slot ${said.get(again[0] ?? '')} ` +
            'of this slide. Write a different point here: what the figure means, what it ' +
            'changed, or what follows from it, without repeating it.',
        });
        continue;
      }
      for (const figure of figures) said.set(figure, text.slotId);
    }
  }
  return findings;
}
