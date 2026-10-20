import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chatMessageSchema, type ChatMessage, type ChatPart } from '@lct/contracts';
import {
  buildPreparation,
  preparationInputSchema,
  readPreparation,
  type Preparation,
  type PreparationEntry,
} from './preparation.js';

const fileId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const url = 'https://example.com/brief';
const quote = 'Бюджет: 25 млн';
type Tool = Extract<ChatPart, { type: 'tool' }>;
type Question = Extract<ChatPart, { type: 'question' }>;

function user(text = 'Для директора', attached = false): ChatMessage {
  return {
    role: 'user',
    id: randomUUID(),
    createdAt: 1,
    mode: 'auto',
    text,
    attachments: attached ? [{ kind: 'file', fileId, name: 'brief.txt', size: 10 }] : [],
  };
}
function assistant(...parts: ChatPart[]): ChatMessage {
  return { role: 'assistant', id: randomUUID(), createdAt: 2, status: 'done', parts };
}
function tool(name: string, output: unknown, input: unknown = {}): Tool {
  return { type: 'tool', callId: randomUUID(), name, status: 'done', input, output };
}
function save(preparation: Preparation): ChatMessage {
  return assistant(tool('save_preparation', preparation));
}
function fact(
  message: ChatMessage,
  key = 'audience',
  value = message.role === 'user' ? message.text : '',
): PreparationEntry {
  return { key, value, status: 'user', evidence: { messageId: message.id, quote: value } };
}
function source(
  message: ChatMessage,
  part: Tool,
  sourceId = fileId,
  text = quote,
): PreparationEntry {
  return {
    key: 'budget',
    value: text,
    status: 'source',
    evidence: { messageId: message.id, callId: part.callId, sourceId, quote: text },
  };
}
function card(key = 'audience', text: string | null = 'Для директора', labels: string[] = []) {
  const questionId = randomUUID();
  const ask = tool('ask_user', { questionId, preparationKey: key });
  const question: Question = {
    type: 'question',
    callId: ask.callId,
    questionId,
    question: 'Для кого презентация?',
    options: [{ label: 'Для директора', description: '' }],
    multiSelect: false,
    answer: text === null ? null : { optionLabels: labels, text },
  };
  return { ask, question, message: assistant(ask, question) };
}
function readOutput(text = quote) {
  return {
    name: 'brief.txt',
    text,
    offset: 0,
    nextOffset: null,
    hasMore: false,
    totalChars: text.length,
  };
}
function researchOutput() {
  return {
    outputTruncated: false,
    summary: 'Клиенты гарантированно удвоят прибыль',
    evidence: [{ sourceId: fileId, name: 'brief.txt', quote, start: 100, support: 'unverified' }],
    openQuestions: [],
    coverage: [
      {
        sourceId: fileId,
        offset: 100,
        readChars: quote.length,
        truncated: true,
        nextOffset: 100 + quote.length,
      },
    ],
    manifest: {
      agentId: 'material-researcher',
      agentVersion: '0.1.0',
      instructionsSha256: 'a'.repeat(64),
      model: 'fake',
      modelRevision: null,
      seed: 42,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
}
function reload(messages: readonly ChatMessage[]): ChatMessage[] {
  return (JSON.parse(JSON.stringify(messages)) as unknown[]).map((message) =>
    chatMessageSchema.parse(message),
  );
}

describe('preparation input bounds', () => {
  it('accepts semantic keys and all five statuses locally', () => {
    for (const status of ['user', 'source', 'assumption', 'unknown', 'declined']) {
      expect(
        preparationInputSchema.parse({ entries: [{ key: 'pilot.success', value: null, status }] })
          .entries,
      ).toHaveLength(1);
    }
  });
  it.each([
    { key: 'x'.repeat(101), value: null, status: 'unknown' },
    { key: ' ', value: null, status: 'unknown' },
    { key: 'goal', value: 'x'.repeat(6001), status: 'assumption' },
    {
      key: 'goal',
      value: null,
      status: 'user',
      evidence: { messageId: 'm', quote: 'x'.repeat(1001) },
    },
  ])('rejects invalid entry %j', (entry) => {
    expect(preparationInputSchema.safeParse({ entries: [entry] }).success).toBe(false);
  });
  it('rejects more than thirty entries', () => {
    expect(
      preparationInputSchema.safeParse({
        entries: Array.from({ length: 31 }, (_, i) => ({
          key: String(i),
          value: null,
          status: 'unknown',
        })),
      }).success,
    ).toBe(false);
  });
});

describe('user provenance', () => {
  it('accepts exact user substrings and preserves their attribution after reload', () => {
    const message = user('Презентация для директора. Цель — согласовать пилот.');
    const entry = fact(message, 'audience', 'для директора');
    const preparation = buildPreparation({ entries: [entry] }, [message]);
    expect(preparation.entries).toEqual([entry]);
    expect(preparation.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(readPreparation(reload([message, save(preparation)]))).toEqual(preparation);
  });
  it.each([
    'missing-message',
    'assistant-prose',
    'inexact-quote',
    'empty-quote',
    'missing-evidence',
    'wrong-call',
  ])('refuses %s', (kind) => {
    const message = user();
    const prose = assistant({ type: 'text', text: 'Для директора' });
    const entry = fact(message);
    if (kind === 'missing-message')
      entry.evidence = { messageId: randomUUID(), quote: 'Для директора' };
    if (kind === 'assistant-prose')
      entry.evidence = { messageId: prose.id, quote: 'Для директора' };
    if (kind === 'inexact-quote' && entry.evidence) entry.evidence.quote = 'для директора';
    if (kind === 'empty-quote' && entry.evidence) entry.evidence.quote = '';
    if (kind === 'missing-evidence') delete entry.evidence;
    if (kind === 'wrong-call' && entry.evidence) entry.evidence.callId = 'made-up';
    expect(() => buildPreparation({ entries: [entry] }, [message, prose])).toThrow(/evidence/);
  });
  it('does not treat another account/chat history as evidence', () => {
    const foreignUser = user();
    expect(() =>
      buildPreparation({ entries: [fact(foreignUser)] }, [user('Другой проект')]),
    ).toThrow(/evidence/);
  });
  it('validates supplied evidence even for an assumption or unknown', () => {
    for (const status of ['assumption', 'unknown', 'declined']) {
      expect(() =>
        buildPreparation(
          {
            entries: [
              {
                key: 'goal',
                status,
                value: null,
                evidence: { messageId: randomUUID(), quote: 'подмена' },
              },
            ],
          },
          [],
        ),
      ).toThrow(/evidence/);
    }
  });
});

describe('source provenance', () => {
  it('accepts read_file output only for an earlier attached file and matching call', () => {
    const attached = user('Материалы', true);
    const read = tool('read_file', readOutput(), { fileId });
    const message = assistant(read);
    const entry = source(message, read);
    const preparation = buildPreparation({ entries: [entry] }, [attached, message]);
    expect(readPreparation(reload([attached, message, save(preparation)]))).toEqual(preparation);
  });
  it.each([
    'unattached',
    'template',
    'failed',
    'running',
    'foreign-file',
    'wrong-call',
    'input-only',
    'unread-tail',
    'attached-later',
  ])('refuses %s as source evidence', (kind) => {
    const attached = user('Материалы', kind !== 'unattached');
    if (attached.role !== 'user') throw new Error('user fixture');
    if (kind === 'template')
      attached.attachments = [{ kind: 'template', templateId: fileId, name: 'template' }];
    const read = tool('read_file', readOutput(), {
      fileId: kind === 'foreign-file' ? otherId : fileId,
    });
    if (kind === 'failed' || kind === 'running') read.status = kind;
    if (kind === 'input-only') read.output = { error: 'denied' };
    const message = assistant(read);
    const entry = source(message, read);
    if (kind === 'wrong-call' && entry.evidence) entry.evidence.callId = 'other-call';
    if (kind === 'unread-tail' && entry.evidence) entry.evidence.quote = 'непрочитанный хвост';
    const messages = kind === 'attached-later' ? [message, attached] : [attached, message];
    expect(() => buildPreparation({ entries: [entry] }, messages)).toThrow(/evidence/);
  });
  it('binds a partial read to the exact returned page', () => {
    const read = tool(
      'read_file',
      {
        ...readOutput(),
        offset: 100,
        nextOffset: 100 + quote.length,
        hasMore: true,
        totalChars: 500,
      },
      { fileId },
    );
    const message = assistant(read);
    expect(
      buildPreparation({ entries: [source(message, read)] }, [user('', true), message]).entries[0]
        ?.status,
    ).toBe('source');
    read.output = { ...readOutput(), nextOffset: 20, hasMore: true, totalChars: 500 };
    expect(() =>
      buildPreparation({ entries: [source(message, read)] }, [user('', true), message]),
    ).toThrow(/evidence/);
  });
  it('accepts only research evidence covered by a read page, never the agent summary', () => {
    const output = researchOutput();
    const research = tool('research_materials', output, { question: 'Бюджет?', fileIds: [fileId] });
    const message = assistant(research);
    const messages = [user('', true), message];
    expect(
      buildPreparation({ entries: [source(message, research)] }, messages).entries[0]?.value,
    ).toBe(quote);
    expect(() =>
      buildPreparation({ entries: [source(message, research, fileId, output.summary)] }, messages),
    ).toThrow(/evidence/);
    const evidence = output.evidence[0];
    if (!evidence) throw new Error('missing evidence fixture');
    evidence.start = 99;
    expect(() => buildPreparation({ entries: [source(message, research)] }, messages)).toThrow(
      /evidence/,
    );
  });
  it('rejects research evidence for a file not requested by the successful tool', () => {
    const research = tool('research_materials', researchOutput(), {
      question: 'Бюджет?',
      fileIds: [otherId],
    });
    const message = assistant(research);
    expect(() =>
      buildPreparation({ entries: [source(message, research)] }, [user('', true), message]),
    ).toThrow(/evidence/);
  });
  it('accepts extract_material and rejects a changed source binding', () => {
    const { hasMore: _more, ...page } = readOutput();
    const output = {
      ...page,
      fileId,
      sourceSha256: 'a'.repeat(64),
      truncated: false,
      coordinateSystem: 'prepared-text-utf16',
    };
    const extract = tool('extract_material', output, { fileId });
    const message = assistant(extract);
    expect(
      buildPreparation({ entries: [source(message, extract)] }, [user('', true), message]).entries,
    ).toHaveLength(1);
    output.fileId = otherId;
    expect(() =>
      buildPreparation({ entries: [source(message, extract)] }, [user('', true), message]),
    ).toThrow(/evidence/);
  });
  it('accepts table values, excluding metadata, nulls and uncached formulas', () => {
    const output = {
      fileId,
      name: 'budget.csv',
      sourceSha256: 'a'.repeat(64),
      kind: 'table',
      sheet: 'Sheet1',
      range: 'A1:A1',
      table: {
        sheet: 'Sheet1',
        range: 'A1:A1',
        cells: [
          {
            address: 'A1',
            row: 1,
            column: 1,
            value: quote,
            formula: null as string | null,
            cached: false,
          },
        ],
        mergedRanges: [],
      },
      offset: 0,
      nextOffset: null,
      truncated: false,
      warnings: ['секретный прогноз'],
    };
    const table = tool('read_table', output, { fileId });
    const message = assistant(table);
    const messages = [user('', true), message];
    expect(buildPreparation({ entries: [source(message, table)] }, messages).entries).toHaveLength(
      1,
    );
    for (const text of ['Sheet1', 'секретный прогноз', 'A1:A1']) {
      expect(() =>
        buildPreparation({ entries: [source(message, table, fileId, text)] }, messages),
      ).toThrow(/evidence/);
    }
    const cell = output.table.cells[0];
    if (!cell) throw new Error('missing cell fixture');
    cell.formula = '=A2';
    expect(() => buildPreparation({ entries: [source(message, table)] }, messages)).toThrow(
      /evidence/,
    );
  });
  it('uses existing fetch provenance and rejects search snippets and research summaries', () => {
    const fetch = tool(
      'fetch_source',
      {
        requestedUrl: url,
        url,
        title: null,
        text: quote,
        fetchedAt: '2026-10-19T10:00:00Z',
        contentHash: 'a'.repeat(64),
        offset: 0,
        nextOffset: null,
        truncated: false,
        trust: 'unverified',
      },
      { url },
    );
    const message = assistant(fetch);
    expect(
      buildPreparation({ entries: [source(message, fetch, url)] }, [message]).entries,
    ).toHaveLength(1);
    fetch.name = 'search_web';
    expect(() => buildPreparation({ entries: [source(message, fetch, url)] }, [message])).toThrow(
      /evidence/,
    );
    fetch.name = 'research_topic';
    expect(() => buildPreparation({ entries: [source(message, fetch, url)] }, [message])).toThrow(
      /evidence/,
    );
  });
});

describe('answered question cards', () => {
  it('extracts option labels and free text as user facts with server-card provenance', () => {
    const { message, ask } = card('audience', 'Совет директоров', ['Для директора']);
    const preparation = readPreparation([message]);
    expect(preparation.entries).toEqual([
      {
        key: 'audience',
        value: 'Для директора\nСовет директоров',
        status: 'user',
        evidence: {
          messageId: message.id,
          callId: ask.callId,
          quote: 'Для директора\nСовет директоров',
        },
      },
    ]);
    expect(buildPreparation({ entries: preparation.entries }, [message])).toEqual(preparation);
    expect(readPreparation(reload([message]))).toEqual(preparation);
  });
  it.each(['wrong-call', 'wrong-question', 'failed', 'running', 'input-only', 'different-message'])(
    'ignores %s bindings',
    (kind) => {
      const { ask, question, message } = card();
      if (kind === 'wrong-call') ask.callId = randomUUID();
      if (kind === 'wrong-question')
        ask.output = { questionId: randomUUID(), preparationKey: 'audience' };
      if (kind === 'failed' || kind === 'running') ask.status = kind;
      if (kind === 'input-only') {
        ask.input = ask.output;
        ask.output = {};
      }
      const messages =
        kind === 'different-message' ? [assistant(ask), assistant(question)] : [message];
      expect(readPreparation(messages).entries).toEqual([]);
    },
  );
  it('keeps the latest answered card per key when a newer card is unanswered', () => {
    const old = card('audience', 'Для покупателя');
    const latest = card('audience', 'Для директора');
    const pending = card('audience', null);
    const goal = card('goal', 'Согласовать пилот');
    expect(
      readPreparation([old.message, latest.message, pending.message, goal.message]).entries.map(
        ({ key, value }) => ({ key, value }),
      ),
    ).toEqual([
      { key: 'audience', value: 'Для директора' },
      { key: 'goal', value: 'Согласовать пилот' },
    ]);
    expect(() =>
      buildPreparation(
        {
          entries: [
            {
              key: 'goal',
              value: 'Для директора',
              status: 'user',
              evidence: {
                messageId: latest.message.id,
                callId: latest.ask.callId,
                quote: 'Для директора',
              },
            },
          ],
        },
        [latest.message],
      ),
    ).toThrow(/evidence/);
  });
  it.each(['Не знаю', 'Неизвестно', 'I don’t know', 'unknown', 'Not sure'])(
    'classifies %s as unknown',
    (text) => {
      const { message } = card('pilot.result', text);
      expect(readPreparation([message]).entries[0]).toMatchObject({
        status: 'unknown',
        value: null,
      });
      const direct = user(text);
      expect(buildPreparation({ entries: [fact(direct)] }, [direct]).entries[0]).toMatchObject({
        status: 'unknown',
        value: null,
      });
    },
  );
  it.each([
    'Без вопросов',
    'Делай без вопросов',
    'Не хочу отвечать',
    'Skip',
    'Prefer not to answer',
    'No questions',
  ])('classifies %s as declined for any semantic key', (text) => {
    const { message } = card('contact.email', '', [text]);
    expect(readPreparation([message]).entries[0]).toMatchObject({
      key: 'contact.email',
      status: 'declined',
      value: null,
    });
  });
  it('never turns explicit unknown or declined into a fact', () => {
    const preparation = buildPreparation(
      {
        entries: [
          { key: 'budget', value: '0', status: 'unknown' },
          { key: 'contact', value: 'sales@example.com', status: 'declined' },
          { key: 'goal', value: 'Обсудить', status: 'assumption' },
        ],
      },
      [],
    );
    expect(preparation.entries).toEqual([
      { key: 'budget', value: null, status: 'unknown' },
      { key: 'contact', value: null, status: 'declined' },
      { key: 'goal', value: 'Обсудить', status: 'assumption' },
    ]);
  });
});

describe('durable preparation replay', () => {
  it('preserves a full supported 4,000-character answer through reload and save', () => {
    const text = 'А'.repeat(4000);
    const { message } = card('requirements.context', text);
    const preparation = readPreparation(reload([message]));
    expect(preparation.entries[0]?.value).toBe(text);
    expect(readPreparation(reload([message, save(preparation)]))).toEqual(preparation);
  });
  it('merges one key while preserving all other facts and accepts an optional server manifest', () => {
    const message = user('Директор. Согласовать пилот. Покупатель.');
    const first = buildPreparation(
      {
        entries: [
          fact(message, 'audience', 'Директор'),
          fact(message, 'goal', 'Согласовать пилот'),
        ],
      },
      [message],
    );
    const stored = save({
      ...first,
      manifest: {
        agentId: 'chat-assistant',
        agentVersion: '1.0.0',
        instructionsSha256: 'a'.repeat(64),
        modelId: 'fake',
        modelRevision: null,
        seed: 42,
      },
    } as Preparation);
    const updated = buildPreparation({ entries: [fact(message, 'audience', 'Покупатель')] }, [
      message,
      stored,
    ]);
    expect(updated.entries).toEqual([
      fact(message, 'audience', 'Покупатель'),
      fact(message, 'goal', 'Согласовать пилот'),
    ]);
    expect(updated.revision).not.toBe(first.revision);
    expect(readPreparation(reload([message, stored, save(updated)]))).toEqual(updated);
  });
  it('ignores model inputs, assistant prose and unfinished save outputs', () => {
    const message = user();
    const valid = buildPreparation({ entries: [fact(message)] }, [message]);
    const pending = tool('save_preparation', valid, valid);
    pending.status = 'running';
    const failed = { ...pending, status: 'failed' as const };
    expect(
      readPreparation([
        message,
        assistant(
          { type: 'text', text: JSON.stringify(valid) },
          tool('save_preparation', undefined, valid),
          pending,
          failed,
        ),
      ]).entries,
    ).toEqual([]);
  });
  it('revalidates persisted evidence and revision instead of trusting a hash or future evidence', () => {
    const message = user();
    const valid = buildPreparation({ entries: [fact(message)] }, [message]);
    expect(() => readPreparation([save(valid), message])).toThrow(/evidence/);
    expect(() => readPreparation([message, save({ ...valid, revision: '0'.repeat(64) })])).toThrow(
      /revision/,
    );
    const entry = valid.entries[0];
    if (!entry) throw new Error('missing entry fixture');
    const changed = {
      ...valid,
      entries: [{ ...entry, evidence: { messageId: message.id, quote: 'Подмена' } }],
    };
    expect(() => readPreparation([message, save(changed)])).toThrow(/evidence/);
  });
  it('does not revive a stale audience when an unrelated key is saved after a newer answer', () => {
    const earlier = card('audience', 'Для покупателя');
    const initial = readPreparation([earlier.message]);
    const newer = card('audience', 'Для директора');
    const messages = [earlier.message, save(initial), newer.message];
    expect(readPreparation([...messages, save(initial)]).entries[0]?.value).toBe('Для директора');
    expect(buildPreparation({ entries: initial.entries }, messages).entries[0]?.value).toBe(
      'Для директора',
    );
    const merged = buildPreparation(
      { entries: [{ key: 'goal', value: 'Пилот', status: 'assumption' }] },
      messages,
    );
    expect(
      readPreparation(reload([...messages, save(merged)])).entries.find(
        (entry) => entry.key === 'audience',
      )?.value,
    ).toBe('Для директора');
  });
  it('keeps a stable SHA256 for a retry, reload and reordered input keys', () => {
    const entries: PreparationEntry[] = [
      { key: 'goal', value: 'Пилот', status: 'assumption' },
      { key: 'audience', value: null, status: 'unknown' },
    ];
    const a = buildPreparation({ entries }, []);
    expect(buildPreparation({ entries: [...entries].reverse() }, [])).toEqual(a);
    const messages = reload([save(a), save(a)]);
    expect(readPreparation(messages)).toEqual(a);
    expect(buildPreparation({ entries: [] }, messages)).toEqual(a);
  });
  it('rejects oversized state atomically without truncating or dropping old keys', () => {
    const entries: PreparationEntry[] = Array.from({ length: 30 }, (_, i) => ({
      key: String(i),
      value: null,
      status: 'unknown',
    }));
    const bounded = buildPreparation({ entries }, []);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(10000);
    expect(() =>
      buildPreparation({ entries: [{ key: 'extra', value: null, status: 'unknown' }] }, [
        save(bounded),
      ]),
    ).toThrow(/too-many/);
    expect(() =>
      buildPreparation(
        {
          entries: entries.map((entry) => ({
            ...entry,
            status: 'assumption',
            value: '\\'.repeat(2000),
          })),
        },
        [],
      ),
    ).toThrow(/too-large/);
  });
});
