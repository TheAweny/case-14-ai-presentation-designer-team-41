import type { LayoutVariantName, SlideElement, SlideIr } from '@lct/contracts';
import { bullets, decor, image, para, run, text } from './elements';
import {
  BAND,
  CONTENT_TITLE_BOX,
  FULL_HEIGHT,
  FULL_WIDTH,
  SLIDE_CX,
  SLIDE_CY,
  box,
  cell,
  columns,
  inset,
  rows,
} from './grid';

/**
 * Демо-колода: питч нашего же продукта, 12 слайдов варианта `balanced`. Это стенд для схемы
 * слайда и будущего рендера, поэтому в колоде есть все виды элементов SlideIR и все роли.
 *
 * `elementId` — слот плана с префиксом слайда, как в фикстурах контрактов: `problem-bullets`.
 * Вертикали — в пунктах от верхнего края слайда, горизонтали — колонками сетки.
 */

const VARIANT: LayoutVariantName = 'balanced';

/** Номера фигур в макетах демо-шаблона: откуда вёрстка взяла бы каждую рамку. */
const SHAPE = {
  title: 2,
  subtitle: 3,
  body: 4,
  bodyRight: 5,
  heading: 6,
  headingRight: 7,
  picture: 8,
  footer: 10,
  pageNumber: 11,
  logo: 12,
  titleRule: 20,
  panel: 21,
  quoteMark: 22,
  /** Карточки и линейки рядов идут подряд от этих номеров. */
  card: 30,
  kpiRule: 40,
} as const;

const LOGO_PART = 'ppt/media/image1.png';
const FOOTER = 'Цифровой дизайнер презентаций · ЛЦТ-2026';

interface SlideScope {
  id(slot: string): string;
  /** Заголовок контентного слайда и линейка под ним — всегда в одних и тех же рамках. */
  header(title: string): SlideElement[];
  /** Колонтитул и номер страницы. На акцентной плашке — в цвете текста на акценте. */
  chrome(tone?: 'default' | 'on-accent'): SlideElement[];
}

type SlideDraft = (index: number) => SlideIr;

/** Слайд без номера: место в колоде он узнаёт, когда колода собрана. */
function slide(
  slideId: string,
  patternId: string,
  build: (scope: SlideScope) => SlideElement[],
): SlideDraft {
  return (index) => {
    const id = (slot: string) => `${slideId}-${slot}`;
    const scope: SlideScope = {
      id,
      header: (title) => [
        text(id('title'), 'title', CONTENT_TITLE_BOX, [para('title', title)], SHAPE.title),
        decor(id('title-rule'), box(columns(0, 2), BAND.titleRule), SHAPE.titleRule),
      ],
      chrome: (tone = 'default') => {
        const color = tone === 'on-accent' ? 'text-on-accent' : undefined;
        return [
          text(
            id('footer'),
            'footer',
            box(columns(0, 8), BAND.footer),
            [para('footer', FOOTER, { color })],
            SHAPE.footer,
          ),
          text(
            id('page-number'),
            'page-number',
            box(columns(11, 1), BAND.footer),
            [para('footer', String(index + 1), { color })],
            SHAPE.pageNumber,
          ),
        ];
      },
    };
    return {
      schemaVersion: 1,
      slideId,
      variant: VARIANT,
      index,
      patternId,
      slideCx: SLIDE_CX,
      slideCy: SLIDE_CY,
      elements: build(scope),
    };
  };
}

const cover = slide('cover', 'title-slide', ({ id }) => [
  // Акцентная плашка до правого края слайда, начиная с девятой колонки.
  decor(
    id('panel'),
    box({ x: columns(8, 4).x, cx: SLIDE_CX - columns(8, 4).x }, FULL_HEIGHT),
    SHAPE.panel,
    { locked: true },
  ),
  image(id('logo'), 'logo', box(columns(0, 2), rows(40, 40)), LOGO_PART, 'contain', SHAPE.logo),
  decor(id('title-rule'), box(columns(0, 2), rows(160, 4)), SHAPE.titleRule),
  text(
    id('title'),
    'title',
    box(columns(0, 7), rows(176, 104)),
    [para('title', 'Цифровой дизайнер презентаций', { sizePt: 44 })],
    SHAPE.title,
  ),
  text(
    id('subtitle'),
    'subtitle',
    box(columns(0, 7), rows(296, 56)),
    [para('subtitle', 'Колода в стиле вашего .pptx-шаблона за пять минут, без ручной вёрстки')],
    SHAPE.subtitle,
  ),
  text(
    id('footer'),
    'footer',
    box(columns(0, 7), BAND.footer),
    [para('footer', 'Хакатон ЛЦТ-2026 · кейс 14 · VK Tech')],
    SHAPE.footer,
  ),
]);

const problem = slide('problem', 'title-and-content', ({ id, header, chrome }) => [
  ...header('Фирменный стиль до сих пор держится на ручной вёрстке'),
  bullets(
    id('bullets'),
    box(columns(0, 8), BAND.body),
    [
      'Генеративные сервисы хорошо пишут текст, но плохо повторяют структуру и дизайн шаблона',
      'Колоду в фирменном стиле всё равно доводит дизайнер — это часы ручной работы',
      'Единый стандарт оформления держится на авторе, а не на инструменте',
      'Каждый новый шаблон приходится заново разбирать на палитру, сетку и макеты',
    ],
    SHAPE.body,
  ),
  ...chrome(),
]);

const caseQuote = slide('case-quote', 'quote', ({ id, chrome }) => [
  decor(id('quote-mark'), box(columns(1, 1), rows(176, 48)), SHAPE.quoteMark),
  text(
    id('quote'),
    'quote',
    box(columns(2, 9), rows(176, 152)),
    [
      para(
        'quote',
        '«Результат должен подтверждать, что система адаптируется к стилю шаблона, а не работает по заранее зашитым сценариям»',
      ),
    ],
    SHAPE.body,
  ),
  text(
    id('attribution'),
    'body',
    box(columns(2, 9), rows(344, 32)),
    [para('subtitle', '— из описания кейса 14, VK Tech · ЛЦТ-2026')],
    SHAPE.subtitle,
  ),
  ...chrome(),
]);

const sectionSolution = slide('section-solution', 'section-header', ({ id, chrome }) => [
  decor(id('panel'), box(FULL_WIDTH, FULL_HEIGHT), SHAPE.panel, { locked: true }),
  text(
    id('title'),
    'title',
    box(columns(0, 8), rows(208, 96)),
    [para('title', 'Как устроено решение', { sizePt: 40, color: 'text-on-accent' })],
    SHAPE.title,
  ),
  text(
    id('subtitle'),
    'subtitle',
    box(columns(0, 8), rows(320, 56)),
    [
      para(
        'subtitle',
        'Пайплайн из пяти этапов, граница между Python и TypeScript и бюджет времени',
        { color: 'text-on-accent' },
      ),
    ],
    SHAPE.subtitle,
  ),
  ...chrome('on-accent'),
]);

const PIPELINE_STEPS = [
  ['Парсинг', 'Разбираем .pptx на правила и кешируем профиль'],
  ['План', 'Агент решает, о чём слайды. Один план — на все три варианта'],
  ['Вёрстка', 'План и профиль дают IR слайдов. Модель здесь не нужна'],
  ['Аудит', 'Геометрия, контраст, заглушки и смысл. Правки выбирает пользователь'],
  ['Экспорт', '.pptx и .pdf поверх шаблона, .html — тем же рендерером, что превью'],
] as const;

const pipeline = slide('pipeline', 'process-steps', ({ id, header, chrome }) => [
  ...header('Пять этапов от шаблона до готовой колоды'),
  ...PIPELINE_STEPS.flatMap(([name, description], i) => {
    const step = `step-${i + 1}`;
    const card = box(cell(i, PIPELINE_STEPS.length), BAND.body);
    const inner = inset(card, 16);
    const span = { x: inner.x, cx: inner.cx };
    return [
      decor(id(`${step}-card`), card, SHAPE.card + i),
      text(
        id(`${step}-name`),
        'subtitle',
        box(span, rows(160, 56)),
        [
          para('heading', String(i + 1).padStart(2, '0'), { color: 'accent' }),
          para('heading', name),
        ],
        null,
      ),
      text(
        id(`${step}-text`),
        'body',
        box(span, rows(232, 216)),
        [para('body', description)],
        null,
      ),
    ];
  }),
  ...chrome(),
]);

const templateRules = slide('template-rules', 'two-content', ({ id, header, chrome }) => [
  ...header('Шаблон разбираем как набор правил, а не как картинку'),
  text(
    id('left-heading'),
    'subtitle',
    box(columns(0, 6), rows(144, 32)),
    [para('heading', 'Что извлекаем из шаблона')],
    SHAPE.heading,
  ),
  bullets(
    id('left-bullets'),
    box(columns(0, 6), rows(192, 272)),
    [
      'Палитру по ролям: фон, текст, акцент, линии',
      'Шрифты и кегли, которыми на самом деле набраны слайды',
      'Сетку: поля, колонки и межколоночный интервал',
      'Макеты и повторяющиеся паттерны фигур',
      { text: 'Паттерн, встреченный хоть раз, — тоже паттерн', level: 1 },
    ],
    SHAPE.body,
  ),
  text(
    id('right-heading'),
    'subtitle',
    box(columns(6, 6), rows(144, 32)),
    [para('heading', 'Как вёрстка это использует')],
    SHAPE.headingRight,
  ),
  bullets(
    id('right-bullets'),
    box(columns(6, 6), rows(192, 272)),
    [
      'Запрашивает цвет по роли, а не по его коду',
      'Верит шрифту со слайдов больше, чем объявленному в теме',
      'Ставит рамки на линии, где шаблон держит свои плейсхолдеры',
      'Под тип слайда берёт паттерн, который шаблон уже использует',
    ],
    SHAPE.bodyRight,
  ),
  ...chrome(),
]);

const layerBoundary = slide('layer-boundary', 'title-and-table', ({ id, header, chrome }) => [
  ...header('Граница проходит по одному признаку — есть ли модель'),
  {
    kind: 'table',
    elementId: id('table'),
    role: 'table',
    box: box(columns(0, 12), rows(144, 256)),
    sourceShapeId: null,
    headers: ['Этап', 'Где живёт', 'Детерминирован', 'Зачем'],
    // Строки в одну строку текста: таблица растёт под текст ячеек и иначе ушла бы за низ слайда.
    rows: [
      ['Разбор шаблона', 'Python · engine.parser', 'Да', 'Палитра, кегли, сетка'],
      ['План колоды', 'TypeScript · @lct/pipeline', 'Нет, модель', 'Тип и данные слайдов'],
      ['Тексты слайдов', 'TypeScript · @lct/pipeline', 'Нет, модель', 'Пишет и сокращает'],
      ['Вёрстка', 'Python · engine.layout', 'Да', 'План и профиль → IR'],
      ['Аудит', 'Python и TypeScript', 'Частично', 'Геометрия и смысл'],
      ['Экспорт', 'Python · engine.export', 'Да', '.pptx и .pdf'],
    ],
  },
  text(
    id('note'),
    'body',
    box(columns(0, 12), rows(416, 48)),
    [
      para('body', [
        run('Всё без модели воспроизводимо: ', 'body', { bold: true }),
        run('движок прогоняется в тестах без GPU и без сети', 'body'),
      ]),
    ],
    SHAPE.body,
  ),
  ...chrome(),
]);

const timeBudget = slide('time-budget', 'title-and-chart', ({ id, header, chrome }) => [
  ...header('Пять минут на колоду расписаны по этапам с запасом'),
  text(
    id('subtitle'),
    'subtitle',
    box(columns(0, 12), rows(144, 24)),
    [para('subtitle', 'Целевое распределение, а не замер: тайминги этапов ещё собираем')],
    SHAPE.subtitle,
  ),
  {
    kind: 'chart',
    elementId: id('chart'),
    role: 'chart',
    box: box(columns(0, 8), rows(184, 280)),
    sourceShapeId: null,
    chartType: 'bar',
    categories: [
      'Разбор шаблона',
      'План колоды',
      'Тексты слайдов',
      'Вёрстка трёх вариантов',
      'Рендер и аудит',
      'Экспорт',
    ],
    // В сумме 240 с из 300: остальное — запас.
    series: [{ name: 'Целевой бюджет', values: [20, 40, 60, 30, 60, 30] }],
    xTitle: 'Этап',
    yTitle: 'Время, с',
  },
  text(
    id('note'),
    'body',
    box(columns(8, 4), rows(184, 280)),
    [
      para('heading', 'Итого 240 с из 300'),
      para('body', '60 с — запас на правки по итогам аудита.'),
      para('body', 'Разбор платится один раз: профиль шаблона кешируется при импорте.'),
      para('body', 'Тексты слайдов пишутся параллельно.'),
    ],
    SHAPE.body,
  ),
  ...chrome(),
]);

const KEY_NUMBERS = [
  ['5 мин', 'бюджет на одну колоду'],
  ['3', 'варианта вёрстки из одного плана'],
  ['10–15', 'слайдов в одной колоде'],
  ['0', 'обращений к модели в Python-движке'],
] as const;

const keyNumbers = slide('key-numbers', 'kpi-row', ({ id, header, chrome }) => [
  ...header('Рамки, под которые спроектирован пайплайн'),
  ...KEY_NUMBERS.flatMap(([value, caption], i) => {
    const span = columns(i * 3, 3);
    const kpi = `kpi-${i + 1}`;
    return [
      decor(id(`${kpi}-rule`), box(span, rows(240, 4)), SHAPE.kpiRule + i),
      text(
        id(`${kpi}-value`),
        'kpi-value',
        box(span, rows(256, 56)),
        [para('kpi-value', value)],
        null,
      ),
      text(
        id(`${kpi}-caption`),
        'kpi-caption',
        box(span, rows(320, 48)),
        [para('kpi-caption', caption)],
        null,
      ),
    ];
  }),
  ...chrome(),
]);

const previewExport = slide('preview-export', 'picture-with-caption', ({ id, header, chrome }) => [
  ...header('Что видно в превью, то и уходит в экспорт'),
  image(
    id('image'),
    'image',
    box(columns(0, 8), BAND.body),
    'media/editor-preview.png',
    'cover',
    SHAPE.picture,
  ),
  text(
    id('caption'),
    'body',
    box(columns(8, 4), BAND.body),
    [
      para('heading', 'Один рендерер на два выхода'),
      para('body', 'Превью в редакторе и HTML-экспорт рисует один и тот же @lct/slide-renderer.'),
      para('caption', '.pptx и .pdf движок собирает поверх исходного шаблона из тех же рамок IR.'),
    ],
    SHAPE.body,
  ),
  ...chrome(),
]);

const comparison = slide('comparison', 'comparison', ({ id, header, chrome }) => {
  const sides = [
    {
      side: 'left',
      span: columns(0, 6),
      heading: para('heading', 'Генератор слайдов'),
      items: [
        'Хорошо пишет текст, хуже повторяет структуру и дизайн',
        'Стиль компании передаёт приблизительно',
        'До стандарта результат доводит дизайнер вручную',
      ],
      shapes: { heading: SHAPE.heading, bullets: SHAPE.body },
    },
    {
      side: 'right',
      span: columns(6, 6),
      heading: para('heading', 'Цифровой дизайнер', { color: 'accent' }),
      items: [
        'Правила берёт из загруженного шаблона, а не из своих тем',
        'Вёрстка детерминирована: тот же вход — тот же результат',
        'Аудит ловит переполнения, слабый контраст и заглушки',
        'Какие правки применить, решает пользователь',
      ],
      shapes: { heading: SHAPE.headingRight, bullets: SHAPE.bodyRight },
    },
  ];
  return [
    ...header('От генерации текста — к вёрстке по правилам шаблона'),
    ...sides.flatMap(({ side, span, heading, items, shapes }, i) => {
      const card = box(span, BAND.body);
      const inner = inset(card, 24);
      const innerSpan = { x: inner.x, cx: inner.cx };
      return [
        decor(id(`${side}-card`), card, SHAPE.card + i),
        text(
          id(`${side}-heading`),
          'subtitle',
          box(innerSpan, rows(168, 32)),
          [heading],
          shapes.heading,
        ),
        bullets(id(`${side}-bullets`), box(innerSpan, rows(216, 224)), items, shapes.bullets),
      ];
    }),
    ...chrome(),
  ];
});

const closing = slide('closing', 'closing', ({ id, chrome }) => [
  image(id('logo'), 'logo', box(columns(0, 2), rows(40, 40)), LOGO_PART, 'contain', SHAPE.logo),
  decor(id('title-rule'), box(columns(0, 2), rows(176, 4)), SHAPE.titleRule),
  text(
    id('title'),
    'title',
    box(columns(0, 9), rows(192, 136)),
    [para('title', 'Открытый код под Apache 2.0 — проверьте на своём шаблоне', { sizePt: 40 })],
    SHAPE.title,
  ),
  text(
    id('subtitle'),
    'subtitle',
    box(columns(0, 8), rows(344, 56)),
    [para('subtitle', 'Веб-интерфейс, API и CLI для прогона по конфигу — в одном репозитории')],
    SHAPE.subtitle,
  ),
  ...chrome(),
]);

const DRAFTS: SlideDraft[] = [
  cover,
  problem,
  caseQuote,
  sectionSolution,
  pipeline,
  templateRules,
  layerBoundary,
  timeBudget,
  keyNumbers,
  previewExport,
  comparison,
  closing,
];

export const DEMO_SLIDES: SlideIr[] = DRAFTS.map((draft, index) => draft(index));
