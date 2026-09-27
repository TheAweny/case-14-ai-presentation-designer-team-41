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

  it('reports an HTTP failure with its status', async () => {
    const provider = new OpenAICompatibleProvider({
      model: planner,
      baseUrl: 'http://runtime/v1',
      apiKey: 'k',
      fetch: () => Promise.resolve(new Response('overloaded', { status: 503 })),
    });
    await expect(provider.complete(request)).rejects.toThrow(/503/);
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

  it('reaches a live runtime at the URL of its variable', () => {
    const provider = createProvider(catalog, 'planner-default', { LLM_BASE_URL: 'http://x/v1' });
    expect(provider.name).toBe('openai-compatible:planner-default');
  });
});
