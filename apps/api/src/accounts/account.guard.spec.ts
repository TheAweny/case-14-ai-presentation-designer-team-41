import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { USER_HEADER } from '../auth/service-token.guard.js';
import { AccountGuard, AdminOnly, AnonymousRoute } from './account.guard.js';
import type { Account } from './account-rules.js';
import type { AccountsService } from './accounts.service.js';

function account(id: string, patch: Partial<Account> = {}): Account {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role: 'user',
    disabled: false,
    createdAt: '2026-09-29T00:00:00.000Z',
    ...patch,
  };
}

const known = new Map<string, Account>([
  ['ann', account('ann')],
  ['root', account('root', { role: 'admin' })],
  ['gone', account('gone', { disabled: true })],
]);

const guard = new AccountGuard(new Reflector(), {
  find: async (id: string) => known.get(id) ?? null,
} as unknown as AccountsService);

function context(userId: string | undefined, decorate?: MethodDecorator) {
  const holder = { handler: () => undefined };
  if (decorate) decorate(holder, 'handler', { value: holder.handler });
  const headers: Record<string, string> = userId === undefined ? {} : { [USER_HEADER]: userId };
  const request = { headers };
  return {
    request,
    context: {
      getHandler: () => holder.handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe('AccountGuard', () => {
  it('lets a known account in', async () => {
    await expect(guard.canActivate(context('ann').context)).resolves.toBe(true);
  });

  it('turns away a request without an account, with an unknown one or a switched-off one', async () => {
    for (const id of [undefined, 'nobody', 'gone']) {
      await expect(guard.canActivate(context(id).context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('keeps administrator routes for administrators', async () => {
    await expect(guard.canActivate(context('ann', AdminOnly()).context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(context('root', AdminOnly()).context)).resolves.toBe(true);
  });

  it('lets sign-in through without an account', async () => {
    await expect(guard.canActivate(context(undefined, AnonymousRoute()).context)).resolves.toBe(
      true,
    );
  });
});
