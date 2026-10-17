import { describe, expect, it } from 'vitest';
import { claimLedgerSchema, claimSchema } from './claims.js';

function userClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: 'user',
    claimId: 'c-revenue',
    statement: 'Выручка выросла на 25% в 2024 году.',
    sourceId: 'brief-1',
    quote: 'Выручка выросла на 25% в 2024 году',
    locator: { page: 1 },
    value: 25,
    unit: '%',
    period: '2024',
    scope: 'выручка',
    ...overrides,
  };
}

function webClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...userClaim(),
    status: 'web',
    locator: { url: 'https://example.com/reports/2024' },
    accepted: false,
    ...overrides,
  };
}

describe('claimSchema', () => {
  it('accepts a user claim quoted from a page', () => {
    expect(claimSchema.safeParse(userClaim()).success).toBe(true);
  });

  it('accepts a user claim quoted from a url', () => {
    const parsed = claimSchema.safeParse(
      userClaim({ locator: { url: 'https://example.com/brief' } }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a user claim without a sourceId', () => {
    const payload = userClaim();
    delete payload.sourceId;
    const result = claimSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('sourceId'))).toBe(true);
    }
  });

  it('rejects a user claim without a quote', () => {
    const payload = userClaim();
    delete payload.quote;
    const result = claimSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('quote'))).toBe(true);
    }
  });

  it('rejects an empty quote', () => {
    expect(claimSchema.safeParse(userClaim({ quote: '' })).success).toBe(false);
  });

  it('rejects a user claim whose page is not a positive integer', () => {
    expect(claimSchema.safeParse(userClaim({ locator: { page: 0 } })).success).toBe(false);
  });

  it('accepts an unaccepted web claim with a url', () => {
    const parsed = claimSchema.safeParse(webClaim());
    if (!parsed.success || parsed.data.status !== 'web') {
      throw new Error('expected an unaccepted web claim');
    }
    expect(parsed.data.accepted).toBe(false);
  });

  it('accepts an accepted web claim', () => {
    const parsed = claimSchema.safeParse(webClaim({ accepted: true }));
    if (!parsed.success || parsed.data.status !== 'web') {
      throw new Error('expected an accepted web claim');
    }
    expect(parsed.data.accepted).toBe(true);
  });

  it('rejects a web claim located only by page', () => {
    const result = claimSchema.safeParse(webClaim({ locator: { page: 2 } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('locator'))).toBe(true);
    }
  });

  it('rejects a web claim with a non-http url', () => {
    expect(
      claimSchema.safeParse(webClaim({ locator: { url: 'ftp://example.com/a' } })).success,
    ).toBe(false);
  });

  it('rejects a web claim that omits accepted', () => {
    const payload = webClaim();
    delete payload.accepted;
    expect(claimSchema.safeParse(payload).success).toBe(false);
  });

  it.each(['process', 'risk', 'criterion'] as const)(
    'accepts an assumption of kind %s with no digit',
    (kind) => {
      expect(
        claimSchema.safeParse({
          schemaVersion: 1,
          status: 'assumption',
          claimId: 'a-review',
          statement: 'Сначала согласуем критерий полноты',
          kind,
        }).success,
      ).toBe(true);
    },
  );

  it('rejects an assumption that contains a digit', () => {
    const result = claimSchema.safeParse({
      schemaVersion: 1,
      status: 'assumption',
      claimId: 'a-1',
      statement: 'Срок согласования — 3 дня',
      kind: 'process',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('statement'))).toBe(true);
    }
  });

  it('rejects an assumption whose kind is not a process, risk, or criterion', () => {
    expect(
      claimSchema.safeParse({
        schemaVersion: 1,
        status: 'assumption',
        claimId: 'a-fact',
        statement: 'Так принято',
        kind: 'fact',
      }).success,
    ).toBe(false);
  });

  it.each(['contradiction', 'insufficient'] as const)(
    'drops a smuggled figure and name from %s',
    (status) => {
      const parsed = claimSchema.parse({
        schemaVersion: 1,
        status,
        claimId: 'c-block',
        statement: 'Анна, 25%',
        value: 25,
        unit: '%',
        name: 'Анна',
      });
      expect(parsed.statement).toBe('Анна, 25%');
      expect(parsed).not.toHaveProperty('value');
      expect(parsed).not.toHaveProperty('name');
      expect(parsed).not.toHaveProperty('quote');
    },
  );

  it('keeps schemaVersion at 1 and refuses a future version', () => {
    expect(claimSchema.safeParse(userClaim()).success).toBe(true);
    expect(claimSchema.safeParse(userClaim({ schemaVersion: 2 })).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(claimSchema.safeParse(userClaim({ status: 'model' })).success).toBe(false);
  });
});

describe('claimLedgerSchema', () => {
  it('accepts a ledger of distinct claims', () => {
    const parsed = claimLedgerSchema.safeParse({
      schemaVersion: 1,
      claims: [userClaim(), webClaim({ claimId: 'c-web' })],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a ledger with a repeated claimId', () => {
    expect(
      claimLedgerSchema.safeParse({
        schemaVersion: 1,
        claims: [userClaim(), webClaim()],
      }).success,
    ).toBe(false);
  });

  it('refuses a future ledger version', () => {
    expect(claimLedgerSchema.safeParse({ schemaVersion: 2, claims: [] }).success).toBe(false);
  });
});
