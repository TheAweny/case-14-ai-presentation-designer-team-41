import type { JobEvent, JobStage } from '@lct/contracts';
import {
  LAYOUT_VARIANTS,
  plannedStages,
  type DeckGenerator,
  type GeneratedVariant,
  type GenerationRequest,
  type StreamedSlide,
} from '../lib/deck-generator';
import type { DeckSource } from '../lib/deck-source';
import type { DeckSummary, LibrarySource } from '../lib/library-source';
import { createDemoLibrarySource } from './demo-library';

/** Шаг сценария: событие прогона или свёрстанный слайд. */
type ScriptStep = { readonly event: JobEvent } | { readonly slide: StreamedSlide };

/**
 * Генерация без сервера: проигрывает те же события, что пришлёт API, в том же порядке, и
 * отдаёт три варианта, которые указывают на существующие демо-колоды — они открываются в
 * редакторе. Новую колоду демо-источник не собирает и не делает вид, что собрал: варианты —
 * колоды, свёрстанные выбранным шаблоном.
 *
 * Шаблон, которым ещё ничего не свёрстано (только что загруженный), честности не убавляет:
 * варианты берутся из любых демо-колод, результат это помечает (`templateSubstituted`), и
 * интерфейс говорит об этом прямо.
 *
 * С источником колод демо отдаёт и слайды по одному: вёрстка идёт по слайдам сбалансированного
 * варианта, и каждый свёрстанный слайд приходит в `onSlide` сразу за своим `stage-progress`.
 */
export function createDemoGenerator({
  library = createDemoLibrarySource(),
  decks,
  stepMs = 90,
}: { library?: LibrarySource; decks?: DeckSource; stepMs?: number } = {}): DeckGenerator {
  let runs = 0;
  return {
    profilesUploadedTemplates: false,
    async generate(request, onEvent, signal, onSlide) {
      runs += 1;
      const runId = `demo-generate-${runs}`;
      if (signal.aborted) throw cancelled();
      const { decks: sources, substituted } = await sourceDecks(library, request);
      if (signal.aborted) throw cancelled();
      const variants = await variantsOf(sources, library);
      const streamed = await streamedSlides(decks, variants);
      if (signal.aborted) throw cancelled();
      await play(
        scriptFor(request, runId, variants, streamed),
        (step) => {
          if ('event' in step) onEvent(step.event);
          else onSlide?.(step.slide);
        },
        signal,
        stepMs,
      );
      return { variants, templateSubstituted: substituted };
    },
  };
}

/** Слайды сбалансированного варианта, если есть откуда их взять. Иначе вёрстка без слайдов. */
async function streamedSlides(
  decks: DeckSource | undefined,
  variants: readonly GeneratedVariant[],
): Promise<readonly StreamedSlide[]> {
  const balanced = variants.find((item) => item.variant === 'balanced') ?? variants[0];
  if (!decks || !balanced) return [];
  const deck = await decks.getDeck(balanced.deckId);
  return deck.slides.map((slide, index) => ({
    index,
    total: deck.slides.length,
    slide,
    designSystem: deck.designSystem,
  }));
}

function cancelled(): DOMException {
  return new DOMException('Generation cancelled', 'AbortError');
}

/**
 * Колоды, из которых демо возьмёт варианты: свёрстанные выбранным шаблоном. Таких нет — любые
 * демо-колоды, лишь бы вариант открывался, и `substituted` это помечает. Неизвестный шаблон —
 * `TemplateNotFoundError`, как ответил бы сервер.
 */
async function sourceDecks(
  library: LibrarySource,
  request: GenerationRequest,
): Promise<{ readonly decks: readonly DeckSummary[]; readonly substituted: boolean }> {
  const { templateId } = await library.getTemplate(request.templateId);
  const all = await library.listDecks();
  const own = all.filter((deck) => deck.templateId === templateId);
  return own.length > 0 ? { decks: own, substituted: false } : { decks: all, substituted: true };
}

/**
 * Три варианта по демо-колодам. Колод меньше трёх — вариант повторяет уже взятую: открывается
 * существующая колода, а не выдуманная.
 */
async function variantsOf(
  decks: readonly DeckSummary[],
  library: LibrarySource,
): Promise<readonly GeneratedVariant[]> {
  if (decks.length === 0) throw new Error('Demo library has no decks');
  const templates = await library.listTemplates();
  return LAYOUT_VARIANTS.map((variant, index) => {
    const deck = decks[index % decks.length] as DeckSummary;
    const template = templates.find((item) => item.templateId === deck.templateId);
    if (!template) throw new Error(`Demo deck without template: ${deck.deckId}`);
    return {
      variant,
      deckId: deck.deckId,
      title: deck.title,
      slideCount: deck.slideCount,
      cover: deck.cover,
      designSystem: template.designSystem,
    } satisfies GeneratedVariant;
  });
}

/** Сценарий по таймеру, по шагу за раз. Отмена останавливает его и отклоняет обещание. */
function play<Step>(
  script: readonly Step[],
  onEvent: (step: Step) => void,
  signal: AbortSignal,
  stepMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(cancelled());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });

    const tick = () => {
      const event = script[at];
      at += 1;
      if (!event) {
        signal.removeEventListener('abort', abort);
        resolve();
        return;
      }
      onEvent(event);
      timer = setTimeout(tick, stepMs);
    };
    timer = setTimeout(tick, stepMs);
  });
}

/**
 * Весь сценарий прогона заранее: события — факты о прошлом, их порядок не меняется. План
 * строится один раз. Вёрстка идёт по слайдам, и свёрстанный слайд идёт сразу за своим
 * прогрессом; превью и аудит — по вариантам, как в настоящем пайплайне.
 */
function scriptFor(
  request: GenerationRequest,
  runId: string,
  variants: readonly GeneratedVariant[],
  slides: readonly StreamedSlide[],
): ScriptStep[] {
  const steps: ScriptStep[] = [];
  let seq = 0;
  const started = Date.now();
  const push = (event: DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>) => {
    steps.push({
      event: {
        ...event,
        schemaVersion: 1,
        runId,
        seq,
        at: new Date(started + seq * 100).toISOString(),
      } as JobEvent,
    });
    seq += 1;
  };
  const planSlides = request.slideCount ?? Math.max(1, ...variants.map((item) => item.slideCount));
  const unitsOf = (stage: JobStage) => {
    if (stage === 'planning') return planSlides;
    if (stage === 'laying-out') return slides.length > 0 ? slides.length : variants.length;
    if (stage === 'rendering' || stage === 'auditing') return variants.length;
    return 1;
  };

  for (const stage of plannedStages()) {
    push({ type: 'stage-started', stage });
    const total = unitsOf(stage);
    for (let done = 1; done <= total; done += 1) {
      push({ type: 'stage-progress', stage, done, total, note: '' });
      const slide = stage === 'laying-out' ? slides[done - 1] : undefined;
      if (slide) steps.push({ slide });
      const variant = stage === 'rendering' ? variants[done - 1]?.variant : undefined;
      if (variant) {
        push({ type: 'artifact-ready', kind: 'preview', variant, path: `${variant}/preview` });
      }
    }
    if (stage === 'planning') {
      push({ type: 'artifact-ready', kind: 'deck-plan', variant: null, path: 'deck-plan.json' });
    }
    if (stage === 'laying-out') {
      for (const { variant } of variants) {
        push({ type: 'artifact-ready', kind: 'slide-ir', variant, path: `${variant}/slides.json` });
      }
    }
    push({ type: 'stage-finished', stage, durationMs: total * 100 });
  }
  push({ type: 'artifact-ready', kind: 'manifest', variant: null, path: 'manifest.json' });
  push({ type: 'done', totalMs: seq * 100, manifestPath: 'manifest.json' });
  return steps;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
