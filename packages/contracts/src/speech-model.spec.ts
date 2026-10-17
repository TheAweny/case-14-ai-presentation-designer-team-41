import { describe, expect, it } from 'vitest';
import { isSpeechModel } from './model-families.js';
import { speechModelOf, type ModelConnection, type ModelSettings } from './model-settings.js';

const connection = (
  connectionId: string,
  models: string[],
  enabledModels: string[] | null = null,
): ModelConnection => ({
  connectionId,
  name: connectionId,
  preset: 'custom',
  baseUrl: 'https://models.example.test/v1',
  hasKey: true,
  keyHint: null,
  managed: false,
  enabledModels,
  lastCheck: { ok: true, at: '2026-10-17T00:00:00Z', models },
});

const settings = (
  connections: ModelConnection[],
  speech: ModelSettings['roles'][number] = { role: 'speech', kind: 'unassigned' },
): ModelSettings => ({ connections, roles: [speech] });

describe('isSpeechModel', () => {
  it.each(['whisper-1', 'openai/whisper-large-v3', 'gpt-4o-mini-transcribe', 'vosk-stt'])(
    'knows %s transcribes',
    (modelId) => expect(isSpeechModel(modelId)).toBe(true),
  );
  it.each(['gpt-6.1-sol', 'claude-sonnet-4-5', 'gpt-4o-mini-tts', 'qwen38-27b-fp8'])(
    'knows %s does not',
    (modelId) => expect(isSpeechModel(modelId)).toBe(false),
  );
});

describe('speechModelOf', () => {
  it('takes a Whisper model of a provider when nothing is assigned', () => {
    const found = speechModelOf(
      settings([
        connection('chat', ['qwen38-27b-fp8']),
        connection('hub', ['gpt-6.1', 'whisper-1']),
      ]),
    );
    expect(found).toEqual({ connectionId: 'hub', modelId: 'whisper-1' });
  });

  it('keeps the assigned model and respects a switched-off dictation', () => {
    const hub = connection('hub', ['whisper-1', 'whisper-large-v3']);
    expect(
      speechModelOf(
        settings([hub], {
          role: 'speech',
          kind: 'model',
          connectionId: 'hub',
          modelId: 'whisper-large-v3',
        }),
      ),
    ).toEqual({ connectionId: 'hub', modelId: 'whisper-large-v3' });
    expect(speechModelOf(settings([hub], { role: 'speech', kind: 'disabled' }))).toBeNull();
  });

  it('skips a speech model the connection switched off', () => {
    expect(
      speechModelOf(settings([connection('hub', ['whisper-1', 'gpt-6.1'], ['gpt-6.1'])])),
    ).toBe(null);
  });
});
