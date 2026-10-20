import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvFile } from './env-file.js';

/** The repository the CLI was built in: apps/cli/dist sits three levels below it. */
export function repoRoot(): string {
  return (
    process.env.LCT_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  );
}

/** How this machine runs Compose: the docker plugin, or the older standalone binary. */
export function composeCommand(): string[] | null {
  if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0) {
    return ['docker', 'compose'];
  }
  if (spawnSync('docker-compose', ['version'], { stdio: 'ignore' }).status === 0) {
    return ['docker-compose'];
  }
  return null;
}

/** Runs a command in the repository, streaming its output, and resolves with its exit code. */
export interface RunOptions {
  quiet?: boolean;
  logFile?: string;
  installationEnv?: boolean;
}

function executionEnv(installation: boolean | undefined): NodeJS.ProcessEnv {
  if (!installation) return process.env;
  const file = EnvFile.open(resolve(repoRoot(), '.env'));
  const env = { ...process.env };
  for (const line of file.text().split('\n')) {
    const key = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1];
    if (key) env[key] = file.get(key);
  }
  return env;
}

export function commandOutput(command: string[], installationEnv = false): string | null {
  const [bin, ...args] = command;
  const result = spawnSync(bin ?? '', args, {
    cwd: repoRoot(),
    env: executionEnv(installationEnv),
    encoding: 'utf8',
    timeout: 15_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function run(command: string[], options: RunOptions = {}): Promise<number> {
  const [bin, ...args] = command;
  return new Promise((resolveCode) => {
    if (options.logFile) mkdirSync(dirname(options.logFile), { recursive: true, mode: 0o700 });
    const log = options.logFile
      ? createWriteStream(options.logFile, { flags: 'a', mode: 0o600 })
      : undefined;
    const child = spawn(bin ?? '', args, {
      cwd: repoRoot(),
      env: executionEnv(options.installationEnv),
      stdio: log ? ['ignore', 'pipe', 'pipe'] : options.quiet ? 'ignore' : 'inherit',
    });
    if (log) {
      child.stdout?.on('data', (chunk: Buffer) => log.write(chunk));
      child.stderr?.on('data', (chunk: Buffer) => log.write(chunk));
      log.on('error', () => child.kill());
    }
    child.on('error', () => {
      log?.end();
      resolveCode(127);
    });
    child.on('close', (code) => {
      if (log) log.end(() => resolveCode(code ?? 1));
      else resolveCode(code ?? 1);
    });
  });
}

export async function compose(args: string[], options: RunOptions = {}): Promise<number> {
  const command = composeCommand();
  if (command === null) {
    throw new Error('Нет Docker Compose: https://docs.docker.com/compose/install/');
  }
  return run([...command, ...args], { ...options, installationEnv: true });
}

export function runningServices(): string[] {
  const command = composeCommand();
  if (!command) return [];
  const output = commandOutput([...command, 'ps', '--status', 'running', '--services'], true);
  return output?.split(/\r?\n/).filter(Boolean) ?? [];
}

/** A stopped/down stack can still own initialized data. Never infer freshness from containers alone. */
export function databaseVolumeExists(): boolean {
  const command = composeCommand();
  if (!command) throw new Error('Нужен Docker Compose для проверки существующей БД.');
  const configuration = commandOutput([...command, 'config', '--format', 'json'], true);
  if (configuration === null) throw new Error('Не удалось проверить конфигурацию хранилища БД.');
  const config = JSON.parse(configuration) as { volumes?: Record<string, { name?: unknown }> };
  const volume = config.volumes?.['postgres-data']?.name;
  if (typeof volume !== 'string' || !volume)
    throw new Error('Не удалось определить Docker volume PostgreSQL.');
  const volumes = commandOutput(['docker', 'volume', 'ls', '--format', '{{.Name}}']);
  if (volumes === null)
    throw new Error('Не удалось проверить Docker volumes. Проверьте службу Docker и права.');
  return volumes.split(/\r?\n/).includes(volume);
}

export function nodeVersionOk(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  return major > 22 || (major === 22 && Number(match[2]) >= 13);
}

/** Whether a TCP port on this machine is free to listen on. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolveFree, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolveFree(false);
        return;
      }
      if (error.code === 'EACCES' && process.platform === 'linux') {
        const sockets = commandOutput(['ss', '-H', '-ltn']);
        if (sockets !== null) {
          resolveFree(
            !sockets.split('\n').some((line) => line.trim().split(/\s+/)[3]?.endsWith(`:${port}`)),
          );
          return;
        }
      }
      reject(
        new Error(
          `Не удалось проверить порт ${port}: ${error.code ?? 'ошибка сети'}. Для портов 80/443 нужен ss (iproute2) или запуск от root.`,
        ),
      );
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolveFree(true)));
  });
}

/** Polls a URL until it answers 2xx, or gives up after `seconds`. */
export async function waitFor(url: string, seconds = 180): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function commandVersion(bin: string, args: string[] = ['--version']): string | null {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  return result.status === 0
    ? ((result.stdout || result.stderr).trim().split('\n')[0] ?? '')
    : null;
}

/** Version of the buildx plugin, or null without one. Compose needs 0.17+ to build images. */
export function buildxVersion(): [number, number] | null {
  const out = commandVersion('docker', ['buildx', 'version']);
  const match = /v?(\d+)\.(\d+)/.exec(out?.split(' ')[1] ?? '');
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export const MIN_BUILDX: [number, number] = [0, 17];

export function buildxOk(): boolean {
  const version = buildxVersion();
  return version !== null && (version[0] > MIN_BUILDX[0] || version[1] >= MIN_BUILDX[1]);
}

export const BUILDX_HINT =
  'Нужен Docker buildx 0.17+: обновите Docker (docs.docker.com/engine/install) или положите ' +
  'бинарник с github.com/docker/buildx/releases в ~/.docker/cli-plugins/docker-buildx';
