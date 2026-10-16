import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelCatalog, ModelEntry } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { describe, expect, it } from 'vitest';
import {
  createProvider,
  extractJson,
  InvalidModelAnswerError,
  OpenAICompatibleProvider,
  RecordedProvider,
  runAgent,
  type ModelProvider,
  type ModelRequest,
} from './index.js';

const agent: LoadedAgent = {
  config: {
    id: 'health-reporter',
    version: '1.0.0',
    description: 'Test agent.',
    modelId: 'planner-default',
    generation: { temperature: 0.2, topP: 0.9, maxOutputTokens: 256 },
    outputSchema: 'HealthCheck',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Report health as JSON.',
  directory: 'registry/agents/health-reporter',
};

const valid = { status: 'ok', service: 'engine', version: '1.0.0', uptimeSeconds: 0 };
const request: ModelRequest = { agent, input: { service: 'engine' }, seed: 7 };

const planner: ModelEntry = {
  id: 'planner-default',
  repo: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  revision: '0d7cf23991f47feeb3a57ecb4c9cee8ea4a17bfe',
  license: 'Apache-2.0',
  sizeB: 30.5,
  type: 'llm',
  provider: 'openai-compatible',
  baseUrlEnv: 'LLM_BASE_URL',
};

const catalog: ModelCatalog = { models: [planner] };

function scripted(...answers: string[]): ModelProvider & { feedback: (string | undefined)[] } {
  const feedback: (string | undefined)[] = [];
  return {
    name: 'scripted',
    feedback,
    complete: (_request, note) => {
      feedback.push(note);
      return Promise.resolve(answers.shift() ?? '');
    },
  };
}

describe('extractJson', () => {
  it('reads JSON out of thinking and markdown fences', () => {
    const answer = '<think>plan it</think>\nHere:\n```json\n{"a": 1}\n```';
    expect(extractJson(answer)).toEqual({ a: 1 });
  });

  it('keeps a code fence that is part of a string', () => {
    const answer = '{"text": "Run:\\n```bash\\nyarn install\\n```"}';
    expect(extractJson(answer)).toEqual({ text: 'Run:\n```bash\nyarn install\n```' });
  });

  it('refuses an answer with no JSON in it', () => {
    expect(() => extractJson('no idea')).toThrow();
  });
});

describe('runAgent', () => {
  it('returns the answer validated against the agent output schema', async () => {
    await expect(runAgent(scripted(JSON.stringify(valid)), request)).resolves.toEqual(valid);
  });

  it('sends an invalid answer back once with what was wrong', async () => {
    const provider = scripted('{"status": "ok"}', JSON.stringify(valid));
    await expect(runAgent(provider, request)).resolves.toEqual(valid);
    expect(provider.feedback[1]).toMatch(/service/);
  });

  it('gives up after the retry', async () => {
    const provider = scripted('{}', 'still not it');
    await expect(runAgent(provider, request)).rejects.toBeInstanceOf(InvalidModelAnswerError);
  });
});

describe('OpenAICompatibleProvider', () => {
  it('sends the agent prompt, input and generation settings', async () => {
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const fakeFetch: typeof fetch = (url, init) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"x":1}' } }] })),
      );
    };
    const provider = new OpenAICompatibleProvider({
      model: planner,
      baseUrl: 'http://runtime/v1/',
      apiKey: 'k',
      fetch: fakeFetch,
    });
    await expect(provider.complete(request)).resolves.toBe('{"x":1}');
    expect(sent?.url).toBe('http://runtime/v1/chat/completions');
    expect(sent?.body).toMatchObject({
      model: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 256,
      seed: 7,
      response_format: { type: 'json_object' },
    });
  });

  it('holds the model to the answer schema when the request carries one', async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenAICompatibleProvider({
      model: planner,
      baseUrl: 'http://runtime/v1',
      apiKey: 'k',
      fetch: (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }),
          ),
        );
      },
    });
    await expect(runAgent(provider, request)).resolves.toEqual(valid);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'HealthCheck', strict: true },
    });
  });

  it("adds the model's extra request fields, such as switching thinking off", async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenAICompatibleProvider({
      model: { ...planner, extraBody: { chat_template_kwargs: { enable_thinking: false } } },
      baseUrl: 'http://runtime/v1',
      apiKey: 'k',
      fetch: (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
        );
      },
    });
    await provider.complete(request);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.model).toBe(planner.repo);
  });

  it('reports a client error at once with its status', async () => {
    let calls = 0;
    const provider = new OpenAICompatibleProvider({
      model: planner,
      baseUrl: 'http://runtime-400/v1',
      apiKey: 'k',
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('bad request', { status: 400 }));
      },
    });
    await expect(provider.complete(request)).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it('waits out a quota answer and never runs more calls at once than allowed', async () => {
    let active = 0;
    let peak = 0;
    let first = true;
    const provider = new OpenAICompatibleProvider({
      model: planner,
      baseUrl: 'http://runtime-quota/v1',
      apiKey: 'k',
      maxConcurrent: 2,
      fetch: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (first) {
          first = false;
          return new Response('quota', { status: 429 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
      },
    });
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => provider.complete(request)));
    expect(answers).toEqual(['{}', '{}', '{}', '{}', '{}']);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('RecordedProvider', () => {
  it('replays what it recorded, without the live model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recordings-'));
    const live = scripted(JSON.stringify(valid));
    await new RecordedProvider({ dir, mode: 'record', live }).complete(request);
    expect(await readdir(join(dir, agent.config.id))).toHaveLength(1);

    const replay = new RecordedProvider({ dir });
    await expect(runAgent(replay, request)).resolves.toEqual(valid);
  });

  it('fails loudly on a request it has not seen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recordings-'));
    await expect(new RecordedProvider({ dir }).complete(request)).rejects.toThrow(/record/);
  });
});

describe('createProvider', () => {
  it('runs every role on recordings when MODEL_PROVIDER is fake', () => {
    expect(createProvider(catalog, 'planner-default', { MODEL_PROVIDER: 'fake' }).name).toBe(
      'fake',
    );
  });

  it('refuses a live model whose runtime URL is not set', () => {
    expect(() => createProvider(catalog, 'planner-default', {})).toThrow(/LLM_BASE_URL/);
  });

  it('takes the served model name from the environment when the provider names it differently', async () => {
    let model = '';
    const env = { LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'qwen/qwen3-30b-a3b' };
    const provider = createProvider(catalog, 'planner-default', env);
    const original = globalThis.fetch;
    globalThis.fetch = (_url, init) => {
      model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      );
    };
    try {
      await provider.complete(request);
    } finally {
      globalThis.fetch = original;
    }
    expect(model).toBe('qwen/qwen3-30b-a3b');
  });

  it('sends MODEL_HEADERS with every request and refuses ones that do not read as headers', async () => {
    let sent: unknown;
    const env = { LLM_BASE_URL: 'http://x/v1', MODEL_HEADERS: 'Project-ID=p-1' };
    const provider = createProvider(catalog, 'planner-default', env);
    const original = globalThis.fetch;
    globalThis.fetch = (_url, init) => {
      sent = init?.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      );
    };
    try {
      await provider.complete(request);
    } finally {
      globalThis.fetch = original;
    }
    expect(sent).toMatchObject({ 'Project-ID': 'p-1' });
    expect(() =>
      createProvider(catalog, 'planner-default', { ...env, MODEL_HEADERS: 'Host=evil' }),
    ).toThrow(/MODEL_HEADERS/);
  });

  it('reaches a live runtime at the URL of its variable', () => {
    const provider = createProvider(catalog, 'planner-default', { LLM_BASE_URL: 'http://x/v1' });
    expect(provider.name).toBe('openai-compatible:planner-default');
  });
});
