import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatMode, ChatPart, DeckOutline } from '@lct/contracts';
import type { ChatTool, ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import type { Account } from '../accounts/account-rules.js';
import { chatTools, recommend, settleWithGrace, type ChatToolScope } from './chat-tools.js';
import { titleOf } from './chats.service.js';

const account: Account = {
  id: 'owner',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'user',
  disabled: false,
  createdAt: '2026-09-29T00:00:00.000Z',
};

const outline: DeckOutline = {
  title: 'Зелёный офис',
  audience: '',
  goal: '',
  slides: Array.from({ length: 10 }, (_, index) => ({
    title: `Тезис ${index + 1}`,
    points: [],
    kind: 'statement' as const,
  })),
};

/** A chat with the tools of one mode, recording what they show and change. */
function chat(
  mode: ChatMode,
  messages: ChatMessage[] = [],
  generation = {} as GenerationService,
  preferences: Partial<ChatToolScope> = {},
) {
  const shown: ChatPart[] = [];
  const updated: { messageId: string; index: number; part: ChatPart }[] = [];
  const scope: ChatToolScope = {
    account,
    chatId: crypto.randomUUID(),
    projectId: null,
    mode,
    model: null,
    messages: () => messages,
    updatePart: (messageId, index, part) => updated.push({ messageId, index, part }),
    addDecks: () => undefined,
    ...preferences,
  };
  const tools = chatTools(generation, scope, undefined, {
    search: null,
    fetchSource: async () => {
      throw new Error('Web fetch is not used in this test.');
    },
  });
  const context: ToolContext = {
    signal: AbortSignal.timeout(5000),
    callId: 'call-1',
    show: (part) => shown.push(part) - 1,
    update: () => undefined,
  };
  const tool = (name: string): ChatTool => {
    const found = tools.find((item) => item.name === name);
    if (!found) throw new Error(`No ${name} in the ${mode} mode.`);
    return found;
  };
  return { tools, tool, context, shown, updated };
}

function planMessage(status: 'proposed' | 'approved'): ChatMessage {
  return {
    role: 'assistant',
    id: crypto.randomUUID(),
    status: 'done',
    createdAt: 1,
    parts: [
      {
        type: 'plan',
        callId: 'c0',
        planId: '00000000-0000-4000-8000-000000000001',
        revision: 1,
        outline,
        templateId: null,
        status,
      },
    ],
  };
}

describe('chat tools by mode', () => {
  it('passes the selected five-slide count through the actual build tool', async () => {
    const started: unknown[] = [];
    const templateId = '00000000-0000-4000-8000-0000000000aa';
    const generation = {
      template: async () => ({ file_name: 'Synthetic.pptx', profile: null }),
      prepare: async () => undefined,
      start: async (input: unknown) => {
        started.push(input);
        throw new Error('Captured request');
      },
    } as unknown as GenerationService;
    const { tool, context } = chat(
      'auto',
      [
        {
          role: 'user',
          id: crypto.randomUUID(),
          text: 'Сделай ровно пять слайдов',
          attachments: [],
          mode: 'auto',
          createdAt: 1,
        },
      ],
      generation,
      { preferredSlideCount: 5 },
    );
    const build = tool('build_deck');
    await build
      .run(build.input.parse({ templateId, brief: 'Исследование пилота' }), context)
      .catch(() => undefined);
    expect(started).toEqual([expect.objectContaining({ slideCount: 5, templateId })]);
  });

  it('uses the sole project template and refuses a count or template ambiguity', async () => {
    const templateId = '00000000-0000-4000-8000-0000000000aa';
    let templates = [{ templateId, name: 'Research' }];
    const generation = {
      projectTemplates: async () => templates,
      pool: {
        query: async (_sql: string, values: string[]) => {
          expect(values[1]).toBe(account.id);
          return { rows: [{ id: values[0], name: 'Research', profile: null }] };
        },
      },
    } as unknown as GenerationService;
    const { tool, context, shown } = chat('plan', [], generation, {
      projectId: crypto.randomUUID(),
      preferredSlideCount: 5,
    });
    const propose = tool('propose_plan');
    const five = { ...outline, slides: outline.slides.slice(0, 5) };
    await propose.run(propose.input.parse({ outline: five }), context);
    expect(shown[0]).toMatchObject({ type: 'plan', templateId, outline: five });
    await expect(propose.run(propose.input.parse({ outline }), context)).rejects.toThrow('ровно 5');
    templates = [
      ...templates,
      { templateId: '00000000-0000-4000-8000-0000000000bb', name: 'Operations' },
    ];
    await expect(
      propose.run(propose.input.parse({ outline: five, templateId }), context),
    ).rejects.toThrow(/несколько|выбер/i);
  });
  it('talks, reads and edits pointed objects in the chat mode, and builds nothing', () => {
    expect(chat('chat').tools.map((tool) => tool.name)).toEqual([
      'generate_qr',
      'list_templates',
      'describe_template',
      'inspect_template_layout',
      'read_file',
      'calculate',
      'fetch_source',
      'inspect_sources',
      'read_deck',
      'read_audit',
      'preview_slide',
      'check_slide_fit',
      'check_content_coverage',
      'read_build_status',
      'edit_slide',
    ]);
    expect(chat('plan').tools.map((tool) => tool.name)).toContain('build_deck');
  });

  it('waits for approval after a plan in the plan mode, and replaces the previous plan', async () => {
    const earlier = planMessage('proposed');
    const { tool, context, shown, updated } = chat('plan', [earlier]);
    const outcome = await tool('propose_plan').run({ outline, templateId: null }, context);
    expect(outcome.stop).toBe(true);
    expect(shown[0]).toMatchObject({ type: 'plan', status: 'proposed' });
    expect(updated).toEqual([
      { messageId: earlier.id, index: 0, part: expect.objectContaining({ status: 'superseded' }) },
    ]);
  });

  it('goes on after a plan in the auto mode', async () => {
    const { tool, context } = chat('auto');
    const outcome = await tool('propose_plan').run({ outline, templateId: null }, context);
    expect(outcome.stop).toBeFalsy();
  });

  it('refuses to build a plan the person has not approved in the plan mode', async () => {
    const { tool, context } = chat('plan', [planMessage('proposed')]);
    const build = tool('build_deck');
    const input = build.input.parse({
      templateId: '00000000-0000-4000-8000-0000000000aa',
      planId: '00000000-0000-4000-8000-000000000001',
    });
    await expect(build.run(input, context)).rejects.toThrow(/not approved/);
    const withoutPlan = build.input.parse({ templateId: '00000000-0000-4000-8000-0000000000aa' });
    await expect(build.run(withoutPlan, context)).rejects.toThrow(/only from a plan/);
  });

  it('never sends the template to the build as material', async () => {
    const templateId = '00000000-0000-4000-8000-0000000000aa';
    const fileId = '00000000-0000-4000-8000-0000000000bb';
    const started: unknown[] = [];
    const generation = {
      template: async () => ({ file_name: 'VK Tech.pptx', profile: null }),
      prepare: async () => undefined,
      start: async (input: unknown) => {
        started.push(input);
        throw new Error('Stop after the request.');
      },
    } as unknown as GenerationService;
    const { tool, context } = chat(
      'auto',
      [
        {
          role: 'user',
          id: crypto.randomUUID(),
          text: 'Подготовь пилот',
          attachments: [],
          mode: 'auto',
          createdAt: 1,
        },
      ],
      generation,
    );
    const build = tool('build_deck');
    await build
      .run(
        build.input.parse({ templateId, brief: 'Пилот', fileIds: [templateId, fileId] }),
        context,
      )
      .catch(() => undefined);
    expect(started).toEqual([expect.objectContaining({ contentIds: [fileId] })]);
  });

  it('asks a question and ends the turn', async () => {
    const { tool, context, shown } = chat('plan');
    const outcome = await tool('ask_user').run(
      tool('ask_user').input.parse({
        question: 'В каком шаблоне?',
        options: [{ label: 'ЦУ' }, { label: 'VK' }],
      }),
      context,
    );
    expect(outcome.stop).toBe(true);
    expect(shown[0]).toMatchObject({ type: 'question', answer: null, multiSelect: false });
  });
});

describe('recommend', () => {
  it('prefers fewer errors, then fewer warnings, then the balanced variant', () => {
    const variant = (v: 'dense' | 'balanced' | 'airy', errors: number, warnings: number) => ({
      variant: v,
      deckId: v,
      errors,
      warnings,
    });
    expect(recommend([variant('dense', 0, 3), variant('balanced', 1, 0)])).toBe('dense');
    expect(recommend([variant('airy', 0, 1), variant('dense', 0, 2)])).toBe('airy');
    expect(recommend([variant('airy', 0, 0), variant('balanced', 0, 0)])).toBe('balanced');
  });

  it('recommends airy for the audit counts in the reported screenshot', () => {
    expect(
      recommend([
        { variant: 'dense', deckId: 'd', errors: 13, warnings: 13 },
        { variant: 'balanced', deckId: 'b', errors: 7, warnings: 7 },
        { variant: 'airy', deckId: 'a', errors: 4, warnings: 6 },
      ]),
    ).toBe('airy');
  });

  it('uses the default preference when an audit is unavailable, rather than treating it as clean', () => {
    expect(
      recommend([
        { variant: 'dense', deckId: 'd', errors: null, warnings: null },
        { variant: 'balanced', deckId: 'b', errors: 2, warnings: 5 },
        { variant: 'airy', deckId: 'a', errors: 0, warnings: 0 },
      ]),
    ).toBe('balanced');
  });
});

describe('titleOf', () => {
  it('names a chat by its first words, cut at a word', () => {
    expect(titleOf('  Презентация   для HR  ', [])).toBe('Презентация для HR');
    const long = titleOf(
      'Сделай презентацию про озеленение офисов для IT-компаний с тарифами и этапами работ',
      [],
    );
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(
      titleOf('', [{ kind: 'template', templateId: crypto.randomUUID(), name: 'ЦУ.pptx' }]),
    ).toBe('ЦУ.pptx');
  });
});

describe('settleWithGrace', () => {
  const dense = { variant: 'dense' as const, runId: 'run-dense' };
  const balanced = { variant: 'balanced' as const, runId: 'run-balanced' };
  const airy = { variant: 'airy' as const, runId: 'run-airy' };
  const variants: { variant: 'dense' | 'balanced' | 'airy'; runId: string }[] = [
    dense,
    balanced,
    airy,
  ];

  it('does not wait for a straggler once the balanced variant is ready', async () => {
    const ended = (variant: (typeof variants)[number], state: 'done' | 'failed') =>
      Promise.resolve({ ...variant, state });
    const result = await settleWithGrace(
      {
        runId: 'run-balanced',
        variants,
        each: [new Promise(() => undefined), ended(balanced, 'done'), ended(airy, 'failed')],
      },
      10,
    );
    expect(result.map((item) => item.state)).toEqual(['running', 'done', 'failed']);
  });

  it('waits for every variant while the balanced one is not ready', async () => {
    let finish!: () => void;
    const late = new Promise<{ variant: 'balanced'; runId: string; state: 'done' }>(
      (resolve) => (finish = () => resolve({ ...balanced, variant: 'balanced', state: 'done' })),
    );
    const pending = settleWithGrace(
      {
        runId: 'run-balanced',
        variants,
        each: [
          Promise.resolve({ ...dense, state: 'done' as const }),
          late,
          Promise.resolve({ ...airy, state: 'done' as const }),
        ],
      },
      10,
    );
    setTimeout(finish, 30);
    expect((await pending).every((item) => item.state === 'done')).toBe(true);
  });
});

describe('edit_slide', () => {
  const pointed: ChatMessage = {
    role: 'user',
    id: crypto.randomUUID(),
    text: 'Сократи подзаголовок',
    mode: 'chat',
    createdAt: 1,
    attachments: [
      {
        kind: 'slides',
        deckId: 'run-1',
        slideNumber: 2,
        name: 'Слайд 2, текст',
        elements: [
          { elementId: 'sub', kind: 'text', role: 'subtitle', text: 'Длинный подзаголовок' },
          { elementId: 'pic', kind: 'image', role: 'image', text: '' },
        ],
      },
    ],
  };

  it('sends new text of an attached object to the editor, with the text the agent saw', async () => {
    const { tool, context, shown } = chat('chat', [pointed]);
    const result = await tool('edit_slide').run(
      { deckId: 'run-1', slideNumber: 2, elementId: 'sub', text: 'Короткий' },
      context,
    );
    expect(shown).toEqual([
      expect.objectContaining({
        type: 'slide-edit',
        deckId: 'run-1',
        slideNumber: 2,
        elementId: 'sub',
        before: 'Длинный подзаголовок',
        text: 'Короткий',
      }),
    ]);
    expect(result.output).toMatchObject({ editId: expect.any(String) });
  });

  it('refuses an object the person did not attach, and one without text', async () => {
    const { tool, context, shown } = chat('auto', [pointed]);
    await expect(
      tool('edit_slide').run(
        { deckId: 'run-1', slideNumber: 3, elementId: 'sub', text: 'x' },
        context,
      ),
    ).rejects.toThrow(/not pointed/);
    await expect(
      tool('edit_slide').run(
        { deckId: 'run-1', slideNumber: 2, elementId: 'pic', text: 'x' },
        context,
      ),
    ).rejects.toThrow(/text object/);
    expect(shown).toEqual([]);
  });
});
