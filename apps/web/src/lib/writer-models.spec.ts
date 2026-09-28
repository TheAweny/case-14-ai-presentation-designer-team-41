import { describe, expect, it } from 'vitest';
import { PIPELINE_ROLES, type ModelConnection, type ModelSettings } from './model-settings';
import {
  effectiveModel,
  modelRows,
  sameModel,
  shortModelName,
  writerModels,
} from './writer-models';

const AT = '2026-09-27T10:00:00.000Z';

function connection(connectionId: string, models: readonly string[] | null): ModelConnection {
  return {
    connectionId,
    name: connectionId.toUpperCase(),
    preset: 'custom',
    baseUrl: `http://${connectionId}.local/v1`,
    hasKey: false,
    keyHint: null,
    lastCheck:
      models === null
        ? { ok: false, at: AT, error: { kind: 'timeout' } }
        : { ok: true, at: AT, models: [...models] },
    managed: false,
  };
}

function settings(
  connections: readonly ModelConnection[],
  writer: { connectionId: string; modelId: string } | null = null,
): ModelSettings {
  return {
    connections: [...connections],
    roles: PIPELINE_ROLES.map((role) =>
      role === 'writer' && writer
        ? { role, kind: 'model' as const, ...writer }
        : { role, kind: 'unassigned' as const },
    ),
  };
}

describe('writerModels', () => {
  it('lists models of checked connections and skips empty or failed ones', () => {
    const list = writerModels(
      settings([connection('ollama', ['qwen3:8b', 'llama3.1:8b']), connection('down', null)]),
    );
    expect(list.groups).toEqual([
      { connectionId: 'ollama', name: 'OLLAMA', models: ['qwen3:8b', 'llama3.1:8b'] },
    ]);
    expect(list.count).toBe(2);
    expect(list.assigned).toBeNull();
  });

  it('keeps the writer model typed in by hand even if the check did not list it', () => {
    const list = writerModels(
      settings([connection('vllm', ['a'])], { connectionId: 'vllm', modelId: 'manual' }),
    );
    expect(list.groups[0]?.models).toEqual(['manual', 'a']);
    expect(list.assigned).toEqual({ connectionId: 'vllm', modelId: 'manual' });
  });

  it('forgets a writer assignment whose connection is gone', () => {
    const list = writerModels(settings([], { connectionId: 'gone', modelId: 'x' }));
    expect(list.assigned).toBeNull();
    expect(list.count).toBe(0);
  });
});

describe('effectiveModel', () => {
  const list = writerModels(
    settings([connection('a', ['one', 'two']), connection('b', ['three'])], {
      connectionId: 'b',
      modelId: 'three',
    }),
  );

  it('prefers the picked model while it is still listed', () => {
    expect(effectiveModel(list, { connectionId: 'a', modelId: 'two' })).toEqual({
      connectionId: 'a',
      modelId: 'two',
    });
  });

  it('falls back to the writer model, then to the first listed one', () => {
    expect(effectiveModel(list, { connectionId: 'a', modelId: 'removed' })).toEqual({
      connectionId: 'b',
      modelId: 'three',
    });
    const unassigned = writerModels(settings([connection('a', ['one'])]));
    expect(effectiveModel(unassigned, null)).toEqual({ connectionId: 'a', modelId: 'one' });
  });

  it('gives nothing when there are no models', () => {
    expect(effectiveModel(writerModels(settings([])), null)).toBeNull();
  });
});

describe('helpers', () => {
  it('compares models by connection and id', () => {
    expect(
      sameModel({ connectionId: 'a', modelId: 'x' }, { connectionId: 'a', modelId: 'x' }),
    ).toBe(true);
    expect(
      sameModel({ connectionId: 'a', modelId: 'x' }, { connectionId: 'b', modelId: 'x' }),
    ).toBe(false);
    expect(sameModel(null, null)).toBe(false);
  });

  it('shortens model ids to their last path segment', () => {
    expect(shortModelName('meta-llama/Llama-3.1-8B-Instruct')).toBe('Llama-3.1-8B-Instruct');
    expect(shortModelName('qwen3:8b')).toBe('qwen3:8b');
  });
});

describe('modelRows', () => {
  const many = Array.from({ length: 10 }, (_, at) => `model-${at}`);
  const list = writerModels(
    settings([connection('cloud', many), connection('local', ['qwen3:8b'])], {
      connectionId: 'cloud',
      modelId: 'model-7',
    }),
  );
  const models = (rows: ReturnType<typeof modelRows>) =>
    rows.flatMap((row) => (row.kind === 'model' ? [row.ref.modelId] : []));

  it('pins the selected and the default model on top of a long list', () => {
    const rows = modelRows(list, { connectionId: 'local', modelId: 'qwen3:8b' }, '');
    expect(rows[0]).toMatchObject({ kind: 'header', section: 'pinned' });
    expect(models(rows).slice(0, 2)).toEqual(['qwen3:8b', 'model-7']);
    expect(rows[1]).toMatchObject({ connectionName: 'LOCAL' });
    expect(rows[2]).toMatchObject({ isDefault: true, connectionName: 'CLOUD' });
  });

  it('pins one row when the selected model is the default one', () => {
    const rows = modelRows(list, { connectionId: 'cloud', modelId: 'model-7' }, '');
    expect(models(rows).filter((id) => id === 'model-7')).toHaveLength(2);
    expect(rows.filter((row) => row.kind === 'header' && row.section === 'pinned')).toHaveLength(1);
    expect(models(rows)[1]).toBe('model-0');
  });

  it('searches model ids and server names, ignoring case, without pinning', () => {
    expect(models(modelRows(list, null, 'QWEN'))).toEqual(['qwen3:8b']);
    expect(models(modelRows(list, null, 'local'))).toEqual(['qwen3:8b']);
    expect(modelRows(list, null, 'nothing')).toEqual([]);
  });

  it('skips headers for a short list on one server', () => {
    const short = writerModels(settings([connection('a', ['one', 'two'])]));
    expect(modelRows(short, null, '').every((row) => row.kind === 'model')).toBe(true);
  });
});
