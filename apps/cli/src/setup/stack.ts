import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository the CLI was built in: apps/cli/dist sits three levels below it. */
export function repoRoot(): string {
  return (
    process.env.LCT_HOME ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  );
}

type Env = Record<string, string | undefined>;

/**
 * The environment of a config run: the project's `.env`, then the shell for what `.env` does not
 * set. `.env` wins: it is what `lct onboard` wrote and what the service runs on, and a variable
 * left in a shell from another project must not send the run to another model.
 */
export function runEnv(envPath: string, shell: Env = process.env): Env {
  if (!existsSync(envPath)) return { ...shell };
  const file: Env = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    const value = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
    if (value !== '') file[match[1]] = value;
  }
  return { ...shell, ...file };
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
export function run(
  command: string[],
  options: { quiet?: boolean; env?: Env } = {},
): Promise<number> {
  const [bin, ...args] = command;
  return new Promise((resolveCode) => {
    const child = spawn(bin ?? '', args, {
      cwd: repoRoot(),
      stdio: options.quiet ? 'ignore' : 'inherit',
      ...(options.env ? { env: options.env as NodeJS.ProcessEnv } : {}),
    });
    child.on('error', () => resolveCode(127));
    child.on('close', (code) => resolveCode(code ?? 1));
  });
}

export async function compose(args: string[], options: { quiet?: boolean } = {}): Promise<number> {
  const command = composeCommand();
  if (command === null) {
    throw new Error('Нет Docker Compose: https://docs.docker.com/compose/install/');
  }
  // Compose fills ${VAR} from the shell before .env. A model address left in the shell by another
  // project would then start the service on another model, so .env goes on top of the shell.
  return run([...command, ...args], { ...options, env: runEnv(join(repoRoot(), '.env')) });
}

/** Whether a TCP port on this machine is free to listen on. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once('error', () => resolveFree(false));
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
