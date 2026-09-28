import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SERVICE_TOKEN_HEADER,
  ServiceTokenGuard,
  configuredServiceToken,
  tokensMatch,
} from './service-token.guard.js';

const TOKEN = 'Zx8v3Qm1Lp7Rt2Wc9Ns4Hd6Kf0Jy5Ga_Eu';
const original = process.env.API_SERVICE_TOKEN;
/** `process.env.X = undefined` would store the string "undefined": unset by deleting. */
function setToken(token: string | undefined) {
  if (token === undefined) delete process.env.API_SERVICE_TOKEN;
  else process.env.API_SERVICE_TOKEN = token;
}
afterEach(() => setToken(original));

function context(headers: Record<string, string>, isPublic = false): ExecutionContext {
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata('lct:public-route', true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guard(token: string | undefined) {
  setToken(token);
  return new ServiceTokenGuard(new Reflector());
}

describe('ServiceTokenGuard', () => {
  it('lets the web server in with the shared token', () => {
    expect(guard(TOKEN).canActivate(context({ [SERVICE_TOKEN_HEADER]: TOKEN }))).toBe(true);
  });

  it('refuses anyone without the token or with another one', () => {
    const subject = guard(TOKEN);
    expect(() => subject.canActivate(context({}))).toThrow(ForbiddenException);
    expect(() => subject.canActivate(context({ [SERVICE_TOKEN_HEADER]: `${TOKEN}x` }))).toThrow(
      ForbiddenException,
    );
  });

  it('keeps /health open for Docker and the installer', () => {
    expect(guard(TOKEN).canActivate(context({}, true))).toBe(true);
  });

  it('refuses every route when no usable token is configured, rather than opening up', () => {
    for (const token of [undefined, '', 'too-short']) {
      const subject = guard(token);
      expect(() => subject.canActivate(context({ [SERVICE_TOKEN_HEADER]: token ?? '' }))).toThrow(
        ServiceUnavailableException,
      );
      expect(subject.canActivate(context({}, true))).toBe(true);
    }
  });
});

describe('tokens', () => {
  it('match only exactly', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(TOKEN, TOKEN.slice(1))).toBe(false);
    expect(tokensMatch(TOKEN, undefined)).toBe(false);
  });

  it('must be long enough to be configured', () => {
    expect(configuredServiceToken({ API_SERVICE_TOKEN: TOKEN })).toBe(TOKEN);
    expect(configuredServiceToken({ API_SERVICE_TOKEN: 'short' })).toBeNull();
  });
});
