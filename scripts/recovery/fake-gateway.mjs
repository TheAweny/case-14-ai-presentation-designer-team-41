import http from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
mkdirSync(root, { recursive: true });
const titles = [
  'Цель пилота',
  'Результаты измерений',
  'Проверка качества',
  'Ограничения исследования',
  'Следующий этап',
];
const points = [
  ['Проверяем доступность сервиса.', 'Пилот проверяет устойчивость.'],
  ['Доступность составила 98 % за 2026 год.', 'Результат относится только к пилоту.'],
  ['Эксперты проверяют журнал качества.', 'Сопоставляем ошибки и наблюдения.'],
  ['Наблюдения получены в тестовой среде.', 'Промышленная нагрузка не проверена.'],
  ['Повторим измерения под нагрузкой.', 'Запуск решим после проверки.'],
];
let holdFrom = null;
const held = [];
function answer(name, input) {
  if (name === 'indexer')
    return {
      notes: input.compositions.map((c) => ({
        patternId: c.patternId,
        kind: 'other',
        items: 2,
        useFor: 'Two evidence points',
        title: 'Research',
        skip: false,
        special: false,
        requiredContent: [],
        slotSemantics: c.slots.map((s) => ({
          slotId: s.slotId,
          role: s.role === 'title' ? 'slide-title' : 'body',
        })),
      })),
    };
  if (name === 'planner')
    return {
      audience: 'Исследователи',
      goal: 'Проверить пилот',
      title: 'Результаты пилота',
      slides: Array.from({ length: input.slideCount ?? 5 }, (_, i) => ({
        patternId: input.catalog[i % input.catalog.length].patternId,
        purpose: titles[i % 5],
        imageQuery: '',
        sourceEvidence: {},
      })),
    };
  if (name === 'critic') return { issues: [], coverage: [] };
  if (name === 'writer')
    return {
      patternId: input.composition.patternId,
      textsBySlot: Object.fromEntries(
        input.composition.slots.map((s, i) => [
          s.slotId,
          s.role === 'title' ? titles[input.index % 5] : points[input.index % 5][(i - 1) % 2],
        ]),
      ),
      speakerNotes: points[input.index % 5].join(' '),
      visual: null,
    };
  if (name === 'rewriter') {
    const index = Math.max(0, titles.indexOf(input.purpose));
    return {
      rewrites: Object.fromEntries(
        input.slots.map((s, i) => {
          const text = s.role === 'title' ? titles[index] : s.text || points[index][i % 2];
          return [s.slotId, [text, text, text]];
        }),
      ),
    };
  }
  throw new Error(`Unexpected agent ${name}`);
}
http
  .createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'recovery-fake' }] }));
      return;
    }
    try {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      if (req.url === '/control') {
        holdFrom = Number.isInteger(body.holdFrom) ? body.holdFrom : null;
        if (holdFrom === null) for (const release of held.splice(0)) release();
        res.end(JSON.stringify({ holdFrom }));
        return;
      }
      const name = body.response_format?.json_schema?.name;
      const input = JSON.parse(body.messages.find((m) => m.role === 'user').content);
      console.log(JSON.stringify({ name, keys: Object.keys(input) }));
      if (name === 'writer' && holdFrom !== null && input.index >= holdFrom)
        await new Promise((resolve) => held.push(resolve));
      const result = answer(name, input);
      appendFileSync(
        new URL('fake-sends.jsonl', root),
        JSON.stringify({ at: new Date().toISOString(), name, index: input.index ?? null }) + '\n',
      );
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(result) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      );
    } catch (e) {
      console.log(e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  })
  .listen(19019, '0.0.0.0', () => console.log('Isolated fake gateway: 19019'));
