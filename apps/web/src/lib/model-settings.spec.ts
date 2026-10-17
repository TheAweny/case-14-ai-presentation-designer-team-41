import { describe, expect, it } from 'vitest';
import {
  API_KEY_MAX_LENGTH,
  CONNECTION_NAME_MAX_LENGTH,
  ConnectionCheckSchema,
  ModelSettingsSchema,
  PIPELINE_ROLES,
  RoleAssignmentSchema,
  apiKeyProblem,
  assignmentFor,
  baseUrlProblem,
  connectionInputProblems,
  connectionLocation,
  connectionNameProblem,
  hasProblems,
  isRoleOptional,
  keyHint,
  modelsEndpoint,
  normalizeBaseUrl,
  rolesUsingConnection,
  suggestedConnectionName,
  unassignedRequiredRoles,
  type ModelSettings,
} from './model-settings';

describe('input checks', () => {
  it('wants a name of reasonable length', () => {
    expect(connectionNameProblem('  ')).toBe('empty');
    expect(connectionNameProblem('x'.repeat(CONNECTION_NAME_MAX_LENGTH + 1))).toBe('tooLong');
    expect(connectionNameProblem(' Ollama ')).toBeNull();
  });

  it('accepts only http and https addresses', () => {
    expect(baseUrlProblem('')).toBe('empty');
    expect(baseUrlProblem('localhost:11434')).toBe('protocol');
    expect(baseUrlProblem('not a url')).toBe('protocol');
    expect(baseUrlProblem('http://')).toBe('invalid');
    expect(baseUrlProblem('http://exa mple.com')).toBe('invalid');
    expect(baseUrlProblem('ftp://models.example.com/v1')).toBe('protocol');
    expect(baseUrlProblem('https://user:secret@models.example.com/v1')).toBe('credentials');
    expect(baseUrlProblem(' http://localhost:11434/v1 ')).toBeNull();
    expect(baseUrlProblem('https://models.example.com/v1')).toBeNull();
  });

  it('flags keys that were pasted with junk or are absurdly long', () => {
    expect(apiKeyProblem('')).toBeNull();
    expect(apiKeyProblem(' sk-abc ')).toBeNull();
    expect(apiKeyProblem('sk-abc def')).toBe('whitespace');
    expect(apiKeyProblem('k'.repeat(API_KEY_MAX_LENGTH + 1))).toBe('tooLong');
  });

  it('collects problems per field', () => {
    expect(connectionInputProblems({ name: '', baseUrl: 'x', apiKey: 'a b' })).toEqual({
      name: 'empty',
      baseUrl: 'protocol',
      apiKey: 'whitespace',
    });
    const fine = connectionInputProblems({ name: 'vLLM', baseUrl: 'http://gpu:8000/v1' });
    expect(fine).toEqual({});
    expect(hasProblems(fine)).toBe(false);
  });

  it('stores the address without trailing slashes and appends /models', () => {
    expect(normalizeBaseUrl(' http://localhost:1234/v1/ ')).toBe('http://localhost:1234/v1');
    expect(modelsEndpoint('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1/models');
  });
});

describe('keyHint', () => {
  it('shows the last four characters of a real key', () => {
    expect(keyHint('sk-proj-0123456789abcd')).toBe('abcd');
  });

  it('shows nothing of a short key and nothing without a key', () => {
    expect(keyHint('secret')).toBeNull();
    expect(keyHint(null)).toBeNull();
  });
});

describe('connectionLocation', () => {
  it('treats loopback, .local and private networks as local', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8000/v1',
      'http://[::1]:1234/v1',
      'http://gpu-box.local:8000/v1',
      'http://192.168.1.20:8000/v1',
      'http://10.0.0.5/v1',
      'http://172.20.0.3:8000/v1',
    ]) {
      expect(connectionLocation(url), url).toBe('local');
    }
  });

  it('treats everything else as cloud', () => {
    for (const url of [
      'https://models.example.com/v1',
      'http://172.32.0.1/v1',
      'https://8.8.8.8/v1',
      'garbage',
    ]) {
      expect(connectionLocation(url), url).toBe('cloud');
    }
  });
});

describe('suggestedConnectionName', () => {
  it('names presets after the runtime and custom servers after the host', () => {
    expect(suggestedConnectionName('ollama', '')).toBe('Ollama');
    expect(suggestedConnectionName('custom', 'https://llm.example.com/v1')).toBe('llm.example.com');
    expect(suggestedConnectionName('custom', '')).toBe('');
  });
});

describe('schemas', () => {
  it('reads a check result either way', () => {
    const at = '2026-09-26T10:00:00.000Z';
    expect(ConnectionCheckSchema.parse({ ok: true, at, models: ['qwen'] }).ok).toBe(true);
    expect(
      ConnectionCheckSchema.safeParse({ ok: false, at, error: { kind: 'timeout' } }).success,
    ).toBe(true);
    expect(
      ConnectionCheckSchema.safeParse({ ok: false, at, error: { kind: 'boom' } }).success,
    ).toBe(false);
  });

  it('knows three kinds of role assignment', () => {
    expect(
      RoleAssignmentSchema.safeParse({
        role: 'writer',
        kind: 'model',
        connectionId: 'c1',
        modelId: ' qwen2.5:7b ',
      }).data,
    ).toEqual({ role: 'writer', kind: 'model', connectionId: 'c1', modelId: 'qwen2.5:7b' });
    expect(RoleAssignmentSchema.safeParse({ role: 'image', kind: 'disabled' }).success).toBe(true);
    expect(
      RoleAssignmentSchema.safeParse({
        role: 'writer',
        kind: 'model',
        connectionId: 'c1',
        modelId: ' ',
      }).success,
    ).toBe(false);
    expect(RoleAssignmentSchema.safeParse({ role: 'painter', kind: 'disabled' }).success).toBe(
      false,
    );
  });
});

describe('roles', () => {
  const settings: ModelSettings = ModelSettingsSchema.parse({
    connections: [],
    roles: [
      { role: 'planner', kind: 'model', connectionId: 'a', modelId: 'm1' },
      { role: 'writer', kind: 'model', connectionId: 'b', modelId: 'm2' },
      { role: 'critic', kind: 'model', connectionId: 'a', modelId: 'm3' },
      { role: 'vision', kind: 'unassigned' },
      { role: 'image', kind: 'unassigned' },
    ],
  });

  it('only the illustrator and voice transcription can be switched off', () => {
    expect(PIPELINE_ROLES.filter(isRoleOptional)).toEqual(['image', 'speech']);
  });

  it('lists required roles still waiting for a model', () => {
    expect(unassignedRequiredRoles(settings)).toEqual(['vision']);
  });

  it('finds roles that depend on a connection', () => {
    expect(rolesUsingConnection(settings, 'a')).toEqual(['planner', 'critic']);
    expect(rolesUsingConnection(settings, 'z')).toEqual([]);
  });

  it('reads a missing assignment as unassigned', () => {
    expect(assignmentFor({ connections: [], roles: [] }, 'writer')).toEqual({
      role: 'writer',
      kind: 'unassigned',
    });
  });
});
