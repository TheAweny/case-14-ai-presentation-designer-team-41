import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoGenerator } from '../mocks/demo-generator';
import { createDemoLibrary } from '../mocks/demo-library';
import { createDemoTemplateImporter } from '../mocks/demo-template-importer';
import {
  createAssistantThreads,
  type AssistantThreads,
  type ThreadMessage,
} from './assistant-threads';
import {
  createDeckConversations,
  needsAudience,
  type AttachTemplate,
  type NewDeckInput,
} from './deck-conversations';
import type { GenerationRequest } from './deck-generator';
import { createGenerationRuns, type GenerationRuns } from './generation-runs';
import type { TemplateSummary } from './library-source';
import { createTemplateImports } from './template-imports';

const request = (brief: string, files: File[] = []): GenerationRequest => ({
  templateId: 'warm-16x9',
  projectId: 'sales',
  brief,
  files,
  slideCount: null,
  modelId: null,
});

const meta = { templateName: 'Тёплый корпоративный.pptx', slideCount: null, modelName: null };
const LONG = 'Итоги третьего квартала для совета директоров: выручка, клиенты, риски и план';

/** Запрос с новым файлом шаблона в проекте «Отдел продаж». */
const withTemplateFile = (file: File): NewDeckInput => ({
  request: { ...request(LONG), templateId: null },
  templateFile: file,
  projectName: 'Отдел продаж',
  meta: { ...meta, templateName: file.name },
  returnHref: '/projects/sales',
});

/** Прогон генерации разговора, если он начался. */
function runOf(threads: AssistantThreads, runs: GenerationRuns, threadId: string) {
  const work = threads.get(threadId)?.messages.find((message) => message.kind === 'work');
  return work?.kind === 'work' ? runs.get(work.runId) : undefined;
}

function setup({
  register,
  attach: attachImpl,
}: {
  register?: (file: File) => Promise<TemplateSummary>;
  attach?: AttachTemplate;
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
  const conversations = createDeckConversations({ threads, runs, imports, attachTemplate: attach });
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

describe('needsAudience', () => {
  it('спрашивает аудиторию только при коротком брифе без файлов', () => {
    expect(needsAudience(request('Итоги Q3'))).toBe(true);
    expect(needsAudience(request(LONG))).toBe(false);
    expect(needsAudience(request('Итоги Q3', [new File(['a'], 'a.csv')]))).toBe(false);
  });
});

describe('createDeckConversations', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('длинный бриф: запрос, сборка, вопрос о варианте; ответ открывает колоду', async () => {
    const { threads, conversations, kinds, agentKeys } = setup();
    const threadId = conversations.start({
      request: request(LONG),
      templateFile: null,
      projectName: 'Отдел продаж',
      meta,
      returnHref: '/',
    });
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'ask:variant']);

    const ask = threads.pendingQuestion(threadId);
    expect(ask?.question.questionId).toBe('variant');
    if (ask?.question.questionId !== 'variant') return;
    expect(ask.question.options.map((option) => option.optionId)).toEqual([
      'dense',
      'balanced',
      'airy',
    ]);
    const airy = ask.question.options[2];
    threads.answer(threadId, ask.id, { optionId: 'airy', text: 'Воздушный' });
    await vi.runAllTimersAsync();
    expect(threads.get(threadId)?.deckId).toBe(airy?.deckId);
    expect(threads.forDeck(airy?.deckId ?? '')?.threadId).toBe(threadId);
    expect(kinds(threadId)?.at(-1)).toBe('agent');
    expect(agentKeys(threadId)?.at(-1)).toBe('opened');
  });

  it('короткий бриф: сначала вопрос об аудитории, ответ уходит в бриф', async () => {
    const { threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start({
      request: request('Итоги Q3'),
      templateFile: null,
      projectName: 'Отдел продаж',
      meta,
      returnHref: '/',
    });
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'ask:audience']);

    const ask = threads.pendingQuestion(threadId);
    threads.answer(threadId, ask?.id ?? '', { optionId: 'leadership', text: 'Руководство' });
    await vi.runAllTimersAsync();
    const work = threads.get(threadId)?.messages.find((message) => message.kind === 'work');
    const run = work?.kind === 'work' ? runs.get(work.runId) : undefined;
    expect(run?.request.brief).toBe('Итоги Q3\n\nРуководство');
    expect(kinds(threadId)?.at(-1)).toBe('ask:variant');
  });

  it('отмена — агент говорит, что остановился; повтор продолжает разговор', async () => {
    const { threads, runs, conversations, kinds } = setup();
    const threadId = conversations.start({
      request: request(LONG),
      templateFile: null,
      projectName: 'Отдел продаж',
      meta,
      returnHref: '/',
    });
    await vi.advanceTimersByTimeAsync(50);
    const work = threads.get(threadId)?.messages.find((message) => message.kind === 'work');
    const runId = work?.kind === 'work' ? work.runId : '';
    runs.cancel(runId);
    await vi.runAllTimersAsync();
    expect(kinds(threadId)).toEqual(['user', 'agent', 'work', 'agent']);

    runs.retry(runId);
    await vi.runAllTimersAsync();
    expect(kinds(threadId)?.at(-1)).toBe('ask:variant');
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
    expect(kinds(threadId)?.at(-1)).toBe('ask:variant');

    const run = runOf(threads, runs, threadId);
    expect(run?.request.templateId).toBe(imported?.templateId);
    // Колод на новом шаблоне у демо нет — генератор честно помечает подмену.
    expect(run?.result?.templateSubstituted).toBe(true);
  });

  it('новый шаблон вне проекта: без вопроса, агент говорит, что шаблон в библиотеке', async () => {
    const { threads, conversations, kinds, agentKeys, attach } = setup();
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
      'ask:variant',
    ]);
    expect(agentKeys(threadId)).toEqual(['templateSaved', 'building']);
    expect(attach).not.toHaveBeenCalled();

    // Колода вне проектов: два других варианта не «в проекте».
    const ask = threads.pendingQuestion(threadId);
    threads.answer(threadId, ask?.id ?? '', { optionId: 'balanced', text: 'Сбалансированный' });
    await vi.runAllTimersAsync();
    expect(agentKeys(threadId)?.at(-1)).toBe('openedNoProject');
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
    expect(runOf(threads, runs, threadId)?.request.templateId).toBe(imported?.templateId);
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
    expect(kinds(threadId)?.at(-1)).toBe('ask:variant');
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
        request: { ...request(LONG), templateId: null },
        templateFile: null,
        projectName: null,
        meta,
        returnHref: '/',
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
});
