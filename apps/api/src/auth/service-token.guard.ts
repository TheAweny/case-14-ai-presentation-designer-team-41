import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The API answers only the web server. Sessions, passwords and the login page live in the web;
 * the web proves it is the caller by a token both share, `API_SERVICE_TOKEN`, which `lct onboard`
 * generates once per installation. A browser, a script or anyone else who reaches the port gets
 * 403, whatever route they try. Only `/health` is open, for Docker and the installer.
 *
 * The web also names the signed-in account in `x-lct-user`. The API trusts it because only the
 * web holds the token, and uses it to record who changed model settings.
 */

export const SERVICE_TOKEN_HEADER = 'x-lct-service-token';
export const USER_HEADER = 'x-lct-user';

/** Shorter than this, a token is guessable and the API refuses to run on it. */
export const SERVICE_TOKEN_MIN_LENGTH = 32;

export const PUBLIC_ROUTE = 'lct:public-route';

/** Marks a route that answers without the service token. Only `/health` should carry it. */
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE, true);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison: the time taken tells nothing about how much of a guess matched. */
export function tokensMatch(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  return timingSafeEqual(digest(expected), digest(presented));
}

export function configuredServiceToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const token = env.API_SERVICE_TOKEN?.trim() ?? '';
  return token.length >= SERVICE_TOKEN_MIN_LENGTH ? token : null;
}

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly logger = new Logger('ServiceToken');
  private readonly token: string | null;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    this.token = configuredServiceToken();
    if (this.token === null) {
      this.logger.error(
        `API_SERVICE_TOKEN is not set or shorter than ${SERVICE_TOKEN_MIN_LENGTH} characters: ` +
          'every route but /health is refused. Run lct onboard or set it in .env.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (this.token === null) {
      throw new ServiceUnavailableException('API_SERVICE_TOKEN is not configured.');
    }
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const presented = request.headers[SERVICE_TOKEN_HEADER];
    if (!tokensMatch(this.token, typeof presented === 'string' ? presented : undefined)) {
      throw new ForbiddenException('This API answers only the web server of this installation.');
    }
    return true;
  }
}

/** The account the web says it acts for, or null. Trusted only behind `ServiceTokenGuard`. */
export const ActingUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
  const value = request.headers[USER_HEADER];
  return typeof value === 'string' && value.length > 0 && value.length <= 320 ? value : null;
});
