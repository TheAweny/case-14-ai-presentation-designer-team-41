import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function run(command: string[], options: { quiet?: boolean } = {}): Promise<number> {
  const [bin, ...args] = command;
  return new Promise((resolveCode) => {
    const child = spawn(bin ?? '', args, {
      cwd: repoRoot(),
      stdio: options.quiet ? 'ignore' : 'inherit',
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
  return run([...command, ...args], options);
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
