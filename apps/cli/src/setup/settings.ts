import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { EnvFile } from './env-file.js';

export function portProblem(value: string): string | undefined {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535
    ? undefined
    : 'Порт — целое число от 1 до 65535';
}

export function domainProblem(value: string): string | undefined {
  return value.length <= 253 &&
    !isIP(value) &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
    ? undefined
    : 'Укажите домен без https://, порта и пути, например slides.example.com';
}

export function serverAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((a) => a.family === 'IPv4' && !a.internal);
    if (address) return address.address;
  }
  return '127.0.0.1';
}

export function hostProblem(value: string): string | undefined {
  return value === 'localhost' || isIP(value)
    ? undefined
    : 'Укажите IP сервера без протокола и порта';
}

export function httpOrigin(host: string, port: string): string {
  return new URL(`http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`).origin;
}

export function localUrls(env: EnvFile): { api: string; web: string } {
  return {
    api: `http://127.0.0.1:${env.get('API_HOST_PORT') || env.get('API_PORT') || '3001'}`,
    web: `http://127.0.0.1:${env.get('WEB_PORT') || '3000'}`,
  };
}

export function publicUrl(env: EnvFile): string {
  if (env.get('APP_ORIGIN')) return env.get('APP_ORIGIN') ?? '';
  const host = env.get('WEB_BIND') === '127.0.0.1' ? 'localhost' : serverAddress();
  return `http://${host}:${env.get('WEB_PORT') || '3000'}`;
}

/** Profile selection lives in .env, so every direct Compose command sees the same installation. */
export function setFeatures(env: EnvFile, docs: boolean, search: boolean): void {
  env.set('API_DOCS_ENABLED', String(docs));
  env.set('WEB_SEARCH_URL', search ? 'http://search:8080' : '');
  const profiles = new Set((env.get('COMPOSE_PROFILES') ?? '').split(',').filter(Boolean));
  if (search) profiles.add('search');
  else profiles.delete('search');
  env.set('COMPOSE_PROFILES', [...profiles].join(','));
}

export function installationLog(root: string): string {
  return join(root, 'data', 'logs', 'install.log');
}
