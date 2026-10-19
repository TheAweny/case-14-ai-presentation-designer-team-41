import { describe, expect, it } from 'vitest';
import { generationFailure } from './failure.js';
import { modelHttpFailure } from '../chat/model-failure.js';

describe('generation failure classification', () => {
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
