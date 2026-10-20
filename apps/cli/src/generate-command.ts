import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { readRunConfig } from './config.js';
import { generateFromConfig } from './generate.js';
import { compose, composeCommand, repoRoot, runEnv } from './setup/stack.js';

export { runEnv };

async function reachable(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.ok)
    .catch(() => false);
}

/** Whether the API container of the service is up. */
function apiRunning(root: string): boolean {
  const command = composeCommand();
  if (command === null) return false;
  const [bin, ...args] = command;
  const result = spawnSync(bin ?? 'docker', [...args, 'ps', '--status', 'running', '--services'], {
    cwd: root,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.split('\n').includes('api');
}

/**
 * `lct generate <config>`. With the engine on this machine (local mode) the decks are built right
 * here. With the service in Docker the engine sits inside its network, so the same command runs
 * in the API container: it reaches the engine and shares `data/` and `runs/` with this machine,
 * and the decks land in `runs/` here.
 */
export async function generateCommand(configPath: string): Promise<number> {
  const root = repoRoot();
  const env = runEnv(join(root, '.env'));
  const config = readRunConfig(configPath);
  const engineUrl = env.ENGINE_URL ?? 'http://localhost:8000';
  if (env.LCT_IN_CONTAINER === '1' || (await reachable(`${engineUrl}/health`))) {
    const result = await generateFromConfig({ config, configPath, env });
    return result.variants.some((variant) => variant.state === 'done') ? 0 : 1;
  }
  if (!apiRunning(root)) {
    throw new Error(
      `Движок не отвечает (${engineUrl}), и сервис в Docker не запущен: lct start, затем повторите.`,
    );
  }

  // Inputs go where the container sees them: data/ here is /app/data there.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const stage = join(root, 'data', 'cli', stamp);
  mkdirSync(stage, { recursive: true });
  const inContainer = (name: string) => `/app/data/cli/${stamp}/${name}`;
  for (const path of [config.templatePath, config.contentPath, config.brandbookPath]) {
    if (path && !existsSync(resolve(path))) throw new Error(`Файл не найден: ${resolve(path)}`);
  }
  const template = basename(config.templatePath);
  const content = basename(config.contentPath);
  copyFileSync(resolve(config.templatePath), join(stage, template));
  copyFileSync(resolve(config.contentPath), join(stage, content));
  // The brandbook goes under its own name: a template and a brandbook may share a file name.
  const brandbook = config.brandbookPath ? `brandbook-${basename(config.brandbookPath)}` : null;
  if (config.brandbookPath && brandbook) {
    copyFileSync(resolve(config.brandbookPath), join(stage, brandbook));
  }
  if (relative(join(root, 'runs'), resolve(config.outputDir)) !== '') {
    process.stdout.write(`outputDir в Docker — всегда runs/ проекта: ${join(root, 'runs')}\n`);
  }
  writeFileSync(
    join(stage, 'run.yaml'),
    toYaml({
      ...config,
      templatePath: inContainer(template),
      contentPath: inContainer(content),
      ...(brandbook ? { brandbookPath: inContainer(brandbook) } : {}),
      outputDir: '/app/runs',
    }),
  );
  process.stdout.write(
    'Сервис в Docker: собираю в контейнере api, /app/runs там — это runs/ здесь\n',
  );
  try {
    return await compose([
      'exec',
      '-T',
      '-e',
      'LCT_IN_CONTAINER=1',
      'api',
      'node',
      'apps/cli/dist/main.js',
      'generate',
      inContainer('run.yaml'),
    ]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
