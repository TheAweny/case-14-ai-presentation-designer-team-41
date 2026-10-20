import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvFile } from './env-file.js';
import { setMedia } from './media.js';
import { setLimits } from './limits.js';

describe('media and runtime setup', () => {
  it('keeps separate provider credentials and clears a disabled media configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lct-media-'));
    try {
      const env = EnvFile.open(join(dir, '.env'));
      env.set('MODEL_API_KEY', 'text-key');
      setMedia(env, 'speech', {
        provider: 'openai',
        'base-url': 'https://voice.example/v1/',
        model: 'ears',
        'api-key': 'voice-key',
      });
      expect(env.get('SPEECH_BASE_URL')).toBe('https://voice.example/v1');
      expect(env.get('SPEECH_API_KEY')).toBe('voice-key');
      setMedia(env, 'image', {
        provider: 'openai',
        'base-url': 'http://localhost:8082/v1',
        model: 'pictures',
      });
      expect(env.get('IMAGE_API_KEY')).toBe('');
      expect(env.get('MODEL_API_KEY')).toBe('text-key');
      setMedia(env, 'speech', { provider: 'disabled' });
      expect(env.get('SPEECH_MODEL')).toBe('');
      expect(env.get('SPEECH_API_KEY')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects incomplete media and validates all limits before changing them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lct-limits-'));
    try {
      const env = EnvFile.open(join(dir, '.env'));
      expect(() => setMedia(env, 'speech', { provider: 'openai', model: 'ears' })).toThrow();
      expect(() => setLimits(env, { 'model-concurrency': '4', 'deadline-ms': '300001' })).toThrow();
      expect(env.get('MODEL_MAX_CONCURRENCY')).toBeUndefined();
      setLimits(env, {
        'model-concurrency': '4',
        'deadline-ms': '120000',
        'generation-concurrency': '2',
      });
      expect(env.get('GENERATION_CONCURRENCY')).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
