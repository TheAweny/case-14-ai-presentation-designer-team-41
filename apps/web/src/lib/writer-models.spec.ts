import { describe, expect, it } from 'vitest';
import { PIPELINE_ROLES, type ModelConnection, type ModelSettings } from './model-settings';
import {
  byFamily,
  effectiveModel,
  modelFamilies,
  modelRows,
  sameModel,
  shortModelName,
  writerModelReady,
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

function limited(base: ModelConnection, enabledModels: readonly string[] | null): ModelConnection {
  return { ...base, enabledModels: enabledModels === null ? null : [...enabledModels] };
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
  it('shares manual role models across text pickers without including image-only or disabled models', () => {
    const data = settings([{ ...connection('personal', []), manualKinds: { drawing: ['image'] } }]);
    data.roles = [
      { role: 'writer', kind: 'model', connectionId: 'personal', modelId: 'manual-writer' },
      { role: 'assistant', kind: 'model', connectionId: 'personal', modelId: 'manual-assistant' },
      { role: 'image', kind: 'model', connectionId: 'personal', modelId: 'drawing' },
    ];
    expect(writerModels(data, 'assistant').groups).toEqual(writerModels(data, 'writer').groups);
    expect(writerModels(data).groups[0]?.models).toEqual(['manual-writer', 'manual-assistant']);
    expect(
      writerModels({
        ...data,
        connections: [{ ...connection('personal', []), enabledModels: ['manual-assistant'] }],
      }).groups[0]?.models,
    ).toEqual(['manual-assistant']);
  });

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

  it('hides a model that was switched off, and one typed by hand past the list', () => {
    const list = writerModels(
      settings(
        [limited(connection('cloud', ['gpt-4o', 'qwen3:8b', 'claude-3-7-sonnet']), ['qwen3:8b'])],
        { connectionId: 'cloud', modelId: 'typed-by-hand' },
      ),
    );
    expect(list.groups[0]?.models).toEqual(['qwen3:8b']);
  });

  it('drops a hand-typed model once that exact id is switched off', () => {
    const list = writerModels(
      settings([limited(connection('cloud', ['gpt-4o', 'qwen3:8b']), ['gpt-4o'])], {
        connectionId: 'cloud',
        modelId: 'qwen3:8b',
      }),
    );
    expect(list.groups[0]?.models).toEqual(['gpt-4o']);
    expect(list.assigned).toEqual({ connectionId: 'cloud', modelId: 'qwen3:8b' });
    // Keep the unavailable selection visible; only the user may choose a replacement.
    expect(effectiveModel(list, null)).toEqual({ connectionId: 'cloud', modelId: 'qwen3:8b' });
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

  it('keeps an unavailable selection and never chooses an arbitrary model', () => {
    expect(effectiveModel(list, { connectionId: 'a', modelId: 'removed' })).toEqual({
      connectionId: 'a',
      modelId: 'removed',
    });
    const unassigned = writerModels(settings([connection('a', ['one'])]));
    expect(effectiveModel(unassigned, null)).toBeNull();
  });

  it('gives nothing when there are no models', () => {
    expect(effectiveModel(writerModels(settings([])), null)).toBeNull();
  });
});

describe('writerModelReady', () => {
  it('does not allow generation while settings are loading', () => {
    expect(writerModelReady(null)).toBe(false);
  });

  it('does not allow generation without a checked model', () => {
    expect(writerModelReady(writerModels(settings([])))).toBe(false);
  });

  it('allows generation when at least one checked model is available', () => {
    const models = writerModels(settings([connection('local', ['qwen3'])]));
    expect(writerModelReady(models)).toBe(false);
    expect(writerModelReady(models, { connectionId: 'local', modelId: 'qwen3' })).toBe(true);
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

  it('groups models by family in chip order, keeping the list order inside', () => {
    expect(byFamily(['qwen3:8b', 'dolphin', 'gpt-4o', 'qwen2.5', 'gpt-4o-mini'])).toEqual([
      { family: 'gpt', models: ['gpt-4o', 'gpt-4o-mini'] },
      { family: 'qwen', models: ['qwen3:8b', 'qwen2.5'] },
      { family: 'other', models: ['dolphin'] },
    ]);
    expect(byFamily([])).toEqual([]);
  });

  it('keeps only the family that was chosen', () => {
    const mixed = writerModels(
      settings([connection('cloud', ['gpt-4o', 'claude-3-7-sonnet', 'qwen3:8b', 'dolphin'])]),
    );
    expect(modelFamilies(mixed)).toEqual(['gpt', 'claude', 'qwen', 'other']);
    expect(models(modelRows(mixed, null, '', 'qwen'))).toEqual(['qwen3:8b']);
    expect(models(modelRows(mixed, null, '', 'other'))).toEqual(['dolphin']);
  });
});

describe('chat model defaults', () => {
  it('shows the assistant override, then follows the primary when requested', () => {
    const source = settings([connection('cloud', ['primary', 'assistant'])], {
      connectionId: 'cloud',
      modelId: 'primary',
    });
    source.roles = source.roles.map((role) =>
      role.role === 'assistant'
        ? { role: 'assistant', kind: 'model', connectionId: 'cloud', modelId: 'assistant' }
        : role,
    );
    expect(effectiveModel(writerModels(source, 'assistant'), null)?.modelId).toBe('assistant');
    source.roles = source.roles.map((role) =>
      role.role === 'assistant' ? { role: 'assistant', kind: 'default' } : role,
    );
    expect(effectiveModel(writerModels(source, 'assistant'), null)?.modelId).toBe('primary');
  });
});

describe('hosted model display names', () => {
  it('shows the actual model, preserving the full URI in the stored reference', () => {
    expect(shortModelName('gpt://folder/qwen3.6-35b-a3b/latest')).toBe('qwen3.6-35b-a3b');
    expect(shortModelName('gpt://folder/qwen3.6-35b-a3b')).toBe('qwen3.6-35b-a3b');
    expect(shortModelName('org/model-name')).toBe('model-name');
  });
});
