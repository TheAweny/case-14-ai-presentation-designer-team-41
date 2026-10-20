import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeSpeechAction } from './speech-actions';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('./auth-session', () => ({ requireAccount: vi.fn() }));

function recording() {
  const form = new FormData();
  form.set('audio', new File(['audio'], 'speech.mp4', { type: 'audio/mp4' }));
  return form;
}

describe('speech action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not upload an empty recording', async () => {
    expect(await transcribeSpeechAction(new FormData())).toEqual({ ok: false, reason: 'empty' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('explains that speech is unavailable when the provider is missing', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ reason: 'not-configured' }), { status: 503 }),
    );
    expect(await transcribeSpeechAction(recording())).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('preserves the browser audio format and trims the transcript', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ text: '  Привет  ' })));
    expect(await transcribeSpeechAction(recording())).toEqual({ ok: true, text: 'Привет' });
    const body = vi.mocked(apiFetch).mock.calls[0]?.[1]?.body as FormData;
    const file = body.get('file') as File;
    expect(file.name).toBe('speech.mp4');
    expect(file.type).toBe('audio/mp4');
  });

  it('keeps provider status without exposing its response body', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 429, secret: 'provider data' }), { status: 502 }),
    );
    expect(await transcribeSpeechAction(recording())).toEqual({
      ok: false,
      reason: 'failed',
      detail: 'HTTP 429',
    });
  });
});
