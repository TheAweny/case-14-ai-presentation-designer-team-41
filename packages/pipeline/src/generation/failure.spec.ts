import { describe, expect, it } from 'vitest';
import { generationFailure } from './failure.js';
import { modelHttpFailure } from '../chat/model-failure.js';

describe('generation failure classification', () => {
  it('distinguishes administrator policy from provider quota and technical caps', () => {
    expect(
      generationFailure({ code: 'account-limit' }, new AbortController().signal),
    ).toMatchObject({ code: 'account-limit', retryable: false });
    expect(
      generationFailure({ code: 'account-disabled' }, new AbortController().signal),
    ).toMatchObject({ code: 'account-disabled', retryable: false });
  });
  it('retains provider categories after Mastra serializes an Error to plain data', () => {
    expect(
      generationFailure(
        {
          name: 'Error',
          message: 'private diagnostic',
          failure: { kind: 'unsupported', modelId: 'private' },
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ code: 'invalid-response', retryable: false });
  });
  it('distinguishes a durable usage cap from elapsed time after workflow serialization', () => {
    expect(
      generationFailure({ code: 'usage-budget-exceeded' }, new AbortController().signal),
    ).toMatchObject({ code: 'usage-budget-exceeded', retryable: false });
  });
  it.each([
    [new DOMException('deadline', 'TimeoutError'), 'budget-exceeded'],
    [new DOMException('stop', 'AbortError'), 'cancelled'],
    [new Error('worker connection lost'), 'interrupted'],
  ])('distinguishes cancellation from elapsed budget: %s', (reason, code) => {
    const controller = new AbortController();
    controller.abort(reason);
    expect(generationFailure(new Error('wrapped workflow error'), controller.signal).code).toBe(
      code,
    );
  });
  it.each([
    [401, '', 'provider-auth'],
    [429, '', 'provider-rate-limit'],
    [429, '{"error":{"code":"insufficient_quota","message":"secret-key"}}', 'provider-quota'],
    [504, '', 'provider-timeout'],
  ])('retains HTTP %i category without provider secrets', (status, body, code) => {
    const result = generationFailure(
      modelHttpFailure(status, 'private-model', null, body),
      new AbortController().signal,
    );
    expect(result.code).toBe(code);
    expect(result.message).toMatch(/[А-Яа-я]/);
    expect(result.message).not.toMatch(/secret-key|private-model/);
  });
});

describe('an engine error after the deadline passed', () => {
  it('is reported as the engine failure, not as a timeout', async () => {
    const { EngineHttpError } = await import('@lct/engine-client');
    const stop = new AbortController();
    stop.abort(new DOMException('Stage deadline exceeded.', 'TimeoutError'));
    expect(
      generationFailure(
        new EngineHttpError(500, '/v1/composition-decks', 'Internal Server Error'),
        stop.signal,
      ).code,
    ).toBe('export-failed');
  });
});
