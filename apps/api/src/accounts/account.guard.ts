import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE, USER_HEADER } from '../auth/service-token.guard.js';
import type { Account } from './account-rules.js';
import { AccountsService } from './accounts.service.js';
import { SessionsService } from '../auth/sessions.service.js';

/**
 * Whose request this is. Behind `ServiceTokenGuard` the web names the signed-in account in
 * `x-lct-user` together with its revocable `x-lct-session`; neither header alone authenticates
 * a person. This guard looks the account up, turns away one that is gone or switched off,
 * and hands it to the route. Every route works for an account unless it says otherwise:
 * `@AnonymousRoute()` is for sign-in itself, `@AdminOnly()` for the administrator's pages.
 *
 * Routes filter what they read and change by this account, so one person never reaches another
 * person's projects, templates, decks or chats.
 */

const ANONYMOUS_ROUTE = 'lct:anonymous-route';
const ADMIN_ONLY = 'lct:admin-only';
const ACCOUNT = Symbol('lct:account');

/** The route answers without an account: sign-in, which comes before one. */
export const AnonymousRoute = () => SetMetadata(ANONYMOUS_ROUTE, true);

/** Only an administrator may use the route. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

type AccountRequest = { headers: Record<string, unknown>; [ACCOUNT]?: Account };

@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  private flag(key: string, context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) ===
      true
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.flag(PUBLIC_ROUTE, context) || this.flag(ANONYMOUS_ROUTE, context)) return true;
    const request = context.switchToHttp().getRequest<AccountRequest>();
    const userId = request.headers[USER_HEADER];
    if (typeof userId !== 'string' || userId === '' || userId.length > 320) {
      throw new UnauthorizedException('Sign in first.');
    }
    if ((await this.sessions.owner(request.headers['x-lct-session'])) !== userId)
      throw new UnauthorizedException('Сессия завершена. Войдите снова.');
    const account = await this.accounts.find(userId);
    if (!account || account.disabled) throw new UnauthorizedException('Sign in first.');
    if (this.flag(ADMIN_ONLY, context) && account.role !== 'admin') {
      throw new ForbiddenException('Only an administrator can do this.');
    }
    request[ACCOUNT] = account;
    return true;
  }
}

/** The account the request is made for. Present on every route but anonymous ones. */
export const CurrentAccount = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const account = context.switchToHttp().getRequest<AccountRequest>()[ACCOUNT];
  if (!account) throw new UnauthorizedException('Sign in first.');
  return account;
});
