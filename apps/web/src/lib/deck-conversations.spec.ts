import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoGenerator } from '../mocks/demo-generator';
import { createDemoLibrary } from '../mocks/demo-library';
import { createDemoTemplateImporter } from '../mocks/demo-template-importer';
import {
  createAssistantThreads,
  type AssistantThreads,
  type DeckResult,
  type ThreadMessage,
} from './assistant-threads';
import {
  createDeckConversations,
  recommendVariant,
  type AttachTemplate,
  type NewDeckInput,
  type ReviewVariants,
} from './deck-conversations';
import type { DeckGenerator, GeneratedVariant, GenerationRequest } from './deck-generator';
import { createGenerationRuns, type GenerationRuns } from './generation-runs';
import type { TemplateSummary } from './library-source';
import { createTemplateImports } from './template-imports';

const request = (brief: string, files: File[] = []): GenerationRequest => ({
  templateId: 'warm-16x9',
  projectId: 'sales',
  brief,
  files,
  slideCount: null,
  model: null,
});

const meta = { templateName: 'Тёплый корпоративный.pptx', slideCount: null, modelName: null };
const LONG = 'Итоги третьего квартала для совета директоров: выручка, клиенты, риски и план';
const audienceLabels = {
  leadership: 'Для руководства.',
  clients: 'Для клиентов.',
  team: 'Для команды.',
};

/** Запрос из поля: библиотечный шаблон, проект «Отдел продаж». */
const input = (brief: string): NewDeckInput => ({
  request: request(brief),
  templateFile: null,
  projectName: 'Отдел продаж',
  meta,
  returnHref: '/',
  audienceLabels,
});

/** Запрос с новым файлом шаблона в проекте «Отдел продаж». */
const withTemplateFile = (file: File, brief = LONG): NewDeckInput => ({
  request: { ...request(brief), templateId: null },
  templateFile: file,
  projectName: 'Отдел продаж',
  meta: { ...meta, templateName: file.name },
  returnHref: '/projects/sales',
  audienceLabels,
});

/** Прогоны разговора по порядку. */
function runsOf(threads: AssistantThreads, runs: GenerationRuns, threadId: string) {
  return (threads.get(threadId)?.messages ?? []).flatMap((message) => {
    const run = message.kind === 'work' ? runs.get(message.runId) : undefined;
    return run ? [run] : [];
  });
}

function resultOf(threads: AssistantThreads, threadId: string): DeckResult | undefined {
  const message = threads.get(threadId)?.messages.findLast((item) => item.kind === 'result');
  return message?.kind === 'result' ? message.result : undefined;
}

function setup({
  register,
  attach: attachImpl,
  review,
}: {
  register?: (file: File) => Promise<TemplateSummary>;
  attach?: AttachTemplate;
  review?: ReviewVariants;
} = {}) {
  const { library, decks } = createDemoLibrary();
  let next = 0;
  const id = () => `id-${(next += 1)}`;
  const threads = createAssistantThreads(id);
  const runs = createGenerationRuns(createDemoGenerator({ library, decks, stepMs: 10 }), id);
  const imports = createTemplateImports(
    createDemoTemplateImporter({
      register: register ?? ((file) => library.importTemplate(file)),
      stepMs: 10,
    }),
    id,
  );
  const attach = vi.fn<AttachTemplate>(
    attachImpl ??
      (async (projectId, templateId) => {
        await library.attachTemplate(projectId, templateId);
        return { ok: true };
      }),
  );
  const conversations = createDeckConversations({
    threads,
    runs,
    imports,
    attachTemplate: attach,
    review:
      review ??
      (async (variants) =>
        Object.fromEntries(variants.map((item) => [item.deckId, { errors: 0, warnings: 0 }]))),
  });
  const kinds = (threadId: string) =>
    threads
      .get(threadId)
      ?.messages.map((message: ThreadMessage) =>
        message.kind === 'ask' ? `ask:${message.question.questionId}` : message.kind,
      );
  const agentKeys = (threadId: string) =>
    threads
      .get(threadId)
      ?.messages.flatMap((message) =>
        message.kind === 'agent' && 'key' in message.text ? [message.text.key] : [],
      );
  return { library, threads, runs, imports, conversations, kinds, agentKeys, attach };
}

const variant = (name: GeneratedVariant['variant']): GeneratedVariant =>
  ({ variant: name, deckId: `deck-${name}` }) as GeneratedVariant;

describe('recommendVariant', () => {
  const variants = [variant('dense'), variant('balanced'), variant('airy')];

  it('меньше ошибок важнее, затем меньше замечаний', () => {
    expect(
      recommendVariant(variants, {
        'deck-dense': { errors: 0, warnings: 3 },
        'deck-balanced': { errors: 1, warnings: 0 },
        'deck-airy': { errors: 0, warnings: 1 },
      }),
    ).toBe('airy');
  });

  it('при равном аудите — сбалансированный', () => {
    const clean = { errors: 0, warnings: 0 };
    expect(
      recommendVariant(variants, {
        'deck-dense': clean,
        'deck-balanced': clean,
        'deck-airy': clean,
      }),
    ).toBe('balanced');
  });

  it('без аудита — сбалансированный', () => {
    expect(recommendVariant(variants, null)).toBe('balanced');
  });
});

describe('createDeckConversations', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('длинный бриф: запрос, сборка и итог с тремя вариантами — без вопросов', async () => {
    const { threads, conversations, kinds } = setup();
    const threadId = conversations.start(input(LONG));
    await vi.runAllTimersAsync();

    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'result']);
    expect(threads.pendingQuestion(threadId)).toBeUndefined();
    const result = resultOf(threads, threadId);
    expect(result?.variants.map((item) => item.variant)).toEqual(['dense', 'balanced', 'airy']);
    expect(result?.recommended).toBe('balanced');
    expect(result?.reviews).not.toBeNull();
    expect(result?.elapsedMs).toBeGreaterThan(0);
    // Колоду открывает человек из итога: сам разговор её не выбирает.
    expect(threads.get(threadId)?.deckId).toBeNull();
  });

  it('совет — по аудиту: вариант с меньшим числом ошибок', async () => {
    const { threads, conversations } = setup({
      review: async (variants) =>
        Object.fromEntries(
          variants.map((item) => [
            item.deckId,
            { errors: item.variant === 'airy' ? 0 : 2, warnings: 0 },
          ]),
        ),
    });
    const threadId = conversations.start(input(LONG));
    await vi.runAllTimersAsync();
    // У шаблона «Тёплый» в демо три колоды: у каждого варианта своя, и аудит у каждого свой.
    expect(resultOf(threads, threadId)?.recommended).toBe('airy');
  });

  it('сбой аудита — итог без аудита, совет по умолчанию', async () => {
    const { threads, conversations } = setup({
      review: () => Promise.reject(new Error('no decks')),
    });
    const threadId = conversations.start(input(LONG));
    await vi.runAllTimersAsync();
    expect(resultOf(threads, threadId)).toMatchObject({ reviews: null, recommended: 'balanced' });
  });

  it('короткий бриф уходит как есть: аудиторию определяет планировщик, а не допущение', async () => {
    const { threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start(input('Итоги Q3'));
    await vi.runAllTimersAsync();

    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'result']);
    expect(runsOf(threads, runs, threadId)[0]?.request.brief).toBe('Итоги Q3');
  });

  it('пожелание по ходу сборки — идущая сборка молча сменяется новой, с пожеланием', async () => {
    const { threads, runs, conversations, kinds, agentKeys } = setup();
    const threadId = conversations.start(input(LONG));
    await vi.advanceTimersByTimeAsync(50);
    conversations.refine(threadId, 'Добавь слайд о рисках');
    await vi.runAllTimersAsync();

    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'user', 'agent', 'work', 'result']);
    expect(agentKeys(threadId)).toEqual(['building', 'building']);
    const [first, second] = runsOf(threads, runs, threadId);
    expect(first?.phase).toBe('cancelled');
    expect(second?.request.brief).toBe(`${LONG}\n\nДобавь слайд о рисках`);
    expect(resultOf(threads, threadId)?.runId).toBe(second?.runId);
  });

  it('смена модели — ею пишется следующая сборка, идущую она не трогает', async () => {
    const { threads, runs, conversations } = setup();
    const threadId = conversations.start(input(LONG));
    const qwen = { connectionId: 'ollama', modelId: 'qwen3:8b' };
    expect(conversations.modelOf(threadId)).toBeNull();
    conversations.setModel(threadId, qwen);
    expect(conversations.modelOf(threadId)).toEqual(qwen);
    await vi.runAllTimersAsync();
    conversations.refine(threadId, 'Покороче');
    await vi.runAllTimersAsync();

    const [first, second] = runsOf(threads, runs, threadId);
    expect(first?.request.model).toBeNull();
    expect(second?.request.model).toEqual(qwen);
  });

  it('«Собрать заново» — новая сборка с тем же брифом; до первой сборки — ничего', async () => {
    const { threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start(input(LONG));
    await vi.runAllTimersAsync();
    const before = kinds(threadId)?.length ?? 0;
    conversations.again(threadId, 'Собери заново');
    await vi.runAllTimersAsync();

    const built = runsOf(threads, runs, threadId);
    expect(built).toHaveLength(2);
    expect(built[1]?.request.brief).toBe(LONG);
    expect(kinds(threadId)?.slice(before)).toEqual(['user', 'agent', 'work', 'result']);

    const fresh = threads.create('');
    conversations.again(fresh, 'Собери заново');
    expect(threads.get(fresh)?.messages).toEqual([]);
  });

  it('разговор без сборки (начат в панели) — модели у него нет', () => {
    const { threads, conversations } = setup();
    expect(conversations.modelOf(threads.create(''))).toBeUndefined();
  });

  it('пожелание, пока разбирается шаблон, — войдёт в первую сборку', async () => {
    const { threads, runs, conversations, agentKeys } = setup();
    const threadId = conversations.start({
      ...withTemplateFile(new File(['pptx'], 'Бренд.pptx')),
      request: { ...request(LONG), projectId: null, templateId: null },
      projectName: null,
    });
    conversations.refine(threadId, 'Покороче');
    expect(agentKeys(threadId)).toEqual(['refining']);
    await vi.runAllTimersAsync();

    const built = runsOf(threads, runs, threadId);
    expect(built).toHaveLength(1);
    expect(built[0]?.request.brief).toBe(`${LONG}\n\nПокороче`);
  });

  it('та же колода в другом шаблоне — новая сборка на нём, с прежним брифом', async () => {
    const { library, threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start(input(LONG));
    await vi.runAllTimersAsync();
    const other = (await library.listTemplates()).find(
      (template) => template.templateId !== 'warm-16x9',
    );
    if (!other) throw new Error('Demo library needs a second template');

    conversations.rebuildWithTemplate(
      threadId,
      { templateId: other.templateId, name: other.fileName },
      `Собери то же самое в шаблоне «${other.fileName}»`,
    );
    await vi.runAllTimersAsync();

    expect(kinds(threadId)?.slice(4)).toEqual(['user', 'agent', 'work', 'result']);
    const last = threads.get(threadId)?.messages.findLast((item) => item.kind === 'agent');
    expect(last?.kind === 'agent' && last.text).toEqual({
      key: 'building',
      values: { template: other.fileName },
    });
    const run = runsOf(threads, runs, threadId).at(-1);
    expect(run?.request).toMatchObject({ templateId: other.templateId, brief: LONG });

    // Тот же шаблон — пересобирать нечего.
    conversations.rebuildWithTemplate(
      threadId,
      { templateId: other.templateId, name: other.fileName },
      'Ещё раз',
    );
    expect(kinds(threadId)).toHaveLength(8);
  });

  it('отмена — агент говорит, что остановился; повтор продолжает разговор', async () => {
    const { threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start(input(LONG));
    await vi.advanceTimersByTimeAsync(50);
    const runId = runsOf(threads, runs, threadId)[0]?.runId ?? '';
    runs.cancel(runId);
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'agent']);

    runs.retry(runId);
    await vi.runAllTimersAsync();
    expect(kinds(threadId)?.at(-1)).toBe('result');
  });

  it('новый шаблон в проекте: разбор, итог, вопрос; «Прикрепить» прикрепляет и собирает им', async () => {
    const { library, threads, runs, conversations, kinds, agentKeys, attach } = setup();
    const brand = new File(['pptx'], 'Бренд.pptx');
    const threadId = conversations.start(withTemplateFile(brand));
    const first = threads.get(threadId)?.messages[0];
    expect(first?.kind === 'user' && first.attachments).toEqual([
      { kind: 'template', name: 'Бренд.pptx', size: brand.size },
    ]);
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'import', 'template', 'ask:attachTemplate']);

    const imported = (await library.listTemplates()).find((item) => item.fileName === brand.name);
    expect(imported).toBeDefined();
    const summary = threads.get(threadId)?.messages.find((message) => message.kind === 'template');
    expect(summary?.kind === 'template' && summary.template.templateId).toBe(imported?.templateId);

    const ask = threads.pendingQuestion(threadId);
    expect(ask?.question).toMatchObject({
      questionId: 'attachTemplate',
      projectName: 'Отдел продаж',
      defaultOptionId: 'attach',
    });
    threads.answer(threadId, ask?.id ?? '', { optionId: 'attach', text: 'Прикрепить' });
    await vi.runAllTimersAsync();

    expect(attach).toHaveBeenCalledWith('sales', imported?.templateId);
    const project = await library.getProject('sales');
    expect(project.templates.map((item) => item.templateId)).toContain(imported?.templateId);
    expect(agentKeys(threadId)).toEqual(['templateAttached', 'building']);
    expect(kinds(threadId)?.at(-1)).toBe('result');

    const run = runsOf(threads, runs, threadId)[0];
    expect(run?.request.templateId).toBe(imported?.templateId);
    // Колод на новом шаблоне у демо нет — генератор честно помечает подмену, итог тоже.
    expect(run?.result?.templateSubstituted).toBe(true);
    expect(resultOf(threads, threadId)?.templateSubstituted).toBe(true);
  });

  it('новый шаблон вне проекта: без вопроса, агент говорит, что шаблон в библиотеке', async () => {
    const { conversations, kinds, agentKeys, attach } = setup();
    const threadId = conversations.start({
      ...withTemplateFile(new File(['pptx'], 'Бренд.pptx')),
      request: { ...request(LONG), projectId: null, templateId: null },
      projectName: null,
    });
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual([
      'user',
      'import',
      'template',
      'agent',
      'agent',
      'work',
      'result',
    ]);
    expect(agentKeys(threadId)).toEqual(['templateSaved', 'building']);
    expect(attach).not.toHaveBeenCalled();
  });

  it('«Только для этой презентации» — шаблон не прикрепляется, колода собирается им', async () => {
    const { library, threads, runs, conversations, agentKeys, attach } = setup();
    const threadId = conversations.start(withTemplateFile(new File(['pptx'], 'Бренд.pptx')));
    await vi.runAllTimersAsync();
    const ask = threads.pendingQuestion(threadId);
    threads.answer(threadId, ask?.id ?? '', { optionId: 'deckOnly', text: 'Только здесь' });
    await vi.runAllTimersAsync();

    expect(attach).not.toHaveBeenCalled();
    const imported = (await library.listTemplates()).find((item) => item.fileName === 'Бренд.pptx');
    const project = await library.getProject('sales');
    expect(project.templates.map((item) => item.templateId)).not.toContain(imported?.templateId);
    expect(agentKeys(threadId)).toEqual(['templateSaved', 'building']);
    expect(runsOf(threads, runs, threadId)[0]?.request.templateId).toBe(imported?.templateId);
  });

  it('сбой разбора — разговор ждёт повтора из карточки и продолжается с того же места', async () => {
    let calls = 0;
    const { library, threads, imports, conversations, kinds } = setup({
      register: (file) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('engine down'))
          : library.importTemplate(file);
      },
    });
    const threadId = conversations.start(withTemplateFile(new File(['pptx'], 'Бренд.pptx')));
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'import']);
    const card = threads.get(threadId)?.messages[1];
    const importId = card?.kind === 'import' ? card.importId : '';
    expect(imports.get(importId)?.phase).toBe('failed');
    expect(imports.get(importId)?.failure?.retryable).toBe(true);
    expect(threads.pendingQuestion(threadId)).toBeUndefined();

    imports.retry(importId);
    await vi.runAllTimersAsync();
    // Повтор — под тем же id: карточка разбора та же, второй не появляется.
    expect(kinds(threadId)).toEqual(['user', 'import', 'template', 'ask:attachTemplate']);
  });

  it('сбой прикрепления — агент говорит об этом, а колода всё равно собирается', async () => {
    const { threads, conversations, kinds, agentKeys, attach } = setup({
      attach: () => Promise.reject(new Error('server down')),
    });
    const threadId = conversations.start(withTemplateFile(new File(['pptx'], 'Бренд.pptx')));
    await vi.runAllTimersAsync();
    const ask = threads.pendingQuestion(threadId);
    threads.answer(threadId, ask?.id ?? '', { optionId: 'attach', text: 'Прикрепить' });
    await vi.runAllTimersAsync();

    expect(attach).toHaveBeenCalledOnce();
    expect(agentKeys(threadId)).toEqual(['templateAttachFailed', 'building']);
    expect(kinds(threadId)?.at(-1)).toBe('result');
  });

  it('отказ прикрепления значением (`ok: false`) — то же, что исключение', async () => {
    const { threads, conversations, agentKeys } = setup({
      attach: () => Promise.resolve({ ok: false }),
    });
    const threadId = conversations.start(withTemplateFile(new File(['pptx'], 'Бренд.pptx')));
    await vi.runAllTimersAsync();
    const ask = threads.pendingQuestion(threadId);
    threads.answer(threadId, ask?.id ?? '', { optionId: 'attach', text: 'Прикрепить' });
    await vi.runAllTimersAsync();
    expect(agentKeys(threadId)).toEqual(['templateAttachFailed', 'building']);
  });

  it('запрос без шаблона и без файла шаблона не начинается', () => {
    const { conversations } = setup();
    expect(() =>
      conversations.start({
        ...input(LONG),
        request: { ...request(LONG), templateId: null },
        projectName: null,
      }),
    ).toThrow();
  });

  it('сообщение без вопроса — демо-агент честно отвечает, что правок пока не умеет', () => {
    const { threads, conversations } = setup();
    const threadId = threads.create('sales');
    conversations.say(threadId, 'Сократи третий слайд');
    const last = threads.get(threadId)?.messages.at(-1);
    expect(last?.kind === 'agent' && 'key' in last.text && last.text.key).toBe('unsupported');
  });

  it('сообщение с объектами слайда — контекст остаётся в сообщении, агент называет, что видит', () => {
    const { threads, conversations } = setup();
    const threadId = threads.create('sales');
    const slide = {
      schemaVersion: 1 as const,
      slideId: 's1',
      variant: 'balanced' as const,
      index: 0,
      patternId: 'p',
      slideCx: 100,
      slideCy: 50,
      elements: [],
    };
    const attachments = [
      {
        kind: 'slide-ref' as const,
        slideId: 's1',
        elementIds: [],
        subject: { kind: 'slide' as const },
        slideNumber: 4,
        context: { scope: 'slide' as const, slideNumber: 4, slide },
      },
    ];
    conversations.say(threadId, 'Что здесь не так?', attachments);
    const [user, agent] = threads.get(threadId)?.messages ?? [];
    expect(user?.kind === 'user' && user.attachments).toEqual(attachments);
    expect(agent?.kind === 'agent' && agent.text).toEqual({
      key: 'contextSeen',
      seen: [{ subject: { kind: 'slide' }, slideNumber: 4 }],
    });
  });
});

describe('сборка после обновления страницы', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SERVER = {
    runId: 'srv-balanced',
    variantRunIds: ['srv-dense', 'srv-balanced', 'srv-airy'],
  };

  /** Вкладка с генератором, у которого есть сервер: он называет прогон и умеет его досмотреть. */
  function tab() {
    const { library, decks } = createDemoLibrary();
    const demo = createDemoGenerator({ library, decks, stepMs: 10 });
    const follow = vi.fn<NonNullable<DeckGenerator['follow']>>((_run, onEvent, signal, onSlide) =>
      demo.generate(request(LONG), onEvent, signal, onSlide),
    );
    const generator: DeckGenerator = {
      ...demo,
      generate(next, onEvent, signal, onSlide, onServerRun) {
        onServerRun?.(SERVER);
        return demo.generate(next, onEvent, signal, onSlide);
      },
      follow,
    };
    let next = 0;
    const id = () => `id-${(next += 1)}`;
    const threads = createAssistantThreads(id);
    const runs = createGenerationRuns(generator, id);
    const conversations = createDeckConversations({
      threads,
      runs,
      imports: createTemplateImports(
        createDemoTemplateImporter({ register: (file) => library.importTemplate(file) }),
        id,
      ),
      attachTemplate: async () => ({ ok: true }),
    });
    return { threads, runs, conversations, follow };
  }

  it('сообщение о сборке запоминает прогон сервера, как только сервер его принял', async () => {
    const { threads, conversations } = tab();
    const threadId = conversations.start(input(LONG));
    await vi.advanceTimersByTimeAsync(0);
    const work = threads.get(threadId)?.messages.find((message) => message.kind === 'work');
    expect(work?.kind === 'work' && work.server).toMatchObject({
      ...SERVER,
      startedAt: expect.any(Number),
    });
  });

  it('прерванную сборку досматривает по прогону сервера, и итог приходит в разговор', async () => {
    const before = tab();
    const threadId = before.conversations.start(input(LONG));
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = before.conversations.snapshot(threadId);
    const thread = before.threads.get(threadId);
    if (!snapshot || !thread) throw new Error('No conversation to save');

    const after = tab();
    after.conversations.restore(threadId, snapshot);
    after.threads.hydrate(thread);
    after.conversations.resume(threadId);
    after.conversations.resume(threadId);
    await vi.runAllTimersAsync();

    expect(after.follow).toHaveBeenCalledTimes(1);
    expect(after.follow.mock.calls[0]?.[0]).toEqual(SERVER);
    const work = thread.messages.find((message) => message.kind === 'work');
    expect(resultOf(after.threads, threadId)?.runId).toBe(work?.kind === 'work' && work.runId);
  });

  it('сборку с итогом не досматривает', async () => {
    const before = tab();
    const threadId = before.conversations.start(input(LONG));
    await vi.runAllTimersAsync();
    const snapshot = before.conversations.snapshot(threadId);
    const thread = before.threads.get(threadId);
    if (!snapshot || !thread) throw new Error('No conversation to save');

    const after = tab();
    after.conversations.restore(threadId, snapshot);
    after.threads.hydrate(thread);
    after.conversations.resume(threadId);

    expect(after.follow).not.toHaveBeenCalled();
  });
});
