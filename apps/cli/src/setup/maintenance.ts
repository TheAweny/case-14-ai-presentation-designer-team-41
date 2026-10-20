import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { EnvFile } from './env-file.js';
import { localUrls } from './settings.js';
import { repoRoot, waitFor } from './stack.js';
import { spinner } from './ui.js';

export interface MaintenanceProcess {
  command: readonly string[];
  cwd: string;
  stdoutFile?: string;
  installationEnv?: boolean;
}

export type MaintenanceRunner = (
  request: MaintenanceProcess,
) => Promise<{ code: number; stdout: string }>;

/** All filesystem mutations are confined to a private workspace outside the installation. */
export interface MaintenanceStorage {
  prepare(root: string): Promise<string>;
  lock(root: string): Promise<() => Promise<void>>;
  workspace(root: string): Promise<string>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  publish(partial: string, archive: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface MaintenanceDependencies {
  root: () => string;
  platform: string;
  run: MaintenanceRunner;
  storage: MaintenanceStorage;
  log: (message: string) => void;
  healthy: (url: string) => Promise<boolean>;
  urls: (root: string) => { api: string; web: string };
  interrupt: (cancel: () => void) => () => void;
}

class MaintenanceError extends Error {}

function fail(message: string): never {
  throw new MaintenanceError(message);
}

/** Match stack.ts: installation values override shell exports without replacing PATH/Node. */
export function maintenanceEnvironment(
  shell: NodeJS.ProcessEnv,
  file?: Pick<EnvFile, 'text' | 'get'>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...shell, GIT_TERMINAL_PROMPT: '0', NX_DAEMON: 'false' };
  for (const line of file?.text().split('\n') ?? []) {
    const key = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1];
    if (key) env[key] = file?.get(key);
  }
  // GNU tar reads these variables as extra command-line options.
  delete env['TAR_OPTIONS'];
  delete env['GZIP'];
  return env;
}

/** Never forward subprocess output: Git URLs, build scripts and Compose can expose credentials. */
const runProcess: MaintenanceRunner = async ({ command, cwd, stdoutFile, installationEnv }) => {
  const output = stdoutFile ? await fs.open(stdoutFile, 'wx', 0o600) : undefined;
  try {
    return await new Promise((done) => {
      const [bin, ...args] = command;
      const env = maintenanceEnvironment(
        process.env,
        installationEnv ? EnvFile.open(join(cwd, '.env')) : undefined,
      );
      const child = spawn(bin ?? '', args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', output?.fd ?? 'pipe', 'ignore'],
      });
      let stdout = '';
      let overflow = false;
      child.stdout?.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stdout) + chunk.length > 8 * 1024 * 1024) {
          overflow = true;
          child.kill();
        } else stdout += chunk.toString('utf8');
      });
      child.once('error', () => done({ code: 127, stdout: '' }));
      child.once('close', (code) => done({ code: overflow ? 1 : (code ?? 1), stdout }));
    });
  } finally {
    await output?.close();
  }
};

async function privateDirectory(path: string): Promise<void> {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    fail('Не удалось обеспечить права 0700 на служебный каталог.');
  }
}

function requireOutside(root: string, path: string): void {
  const location = relative(root, resolve(path));
  if (location === '' || (!location.startsWith(`..${sep}`) && location !== '..')) {
    fail('Служебный каталог должен находиться вне установки.');
  }
}

const storage: MaintenanceStorage = {
  async prepare(path) {
    const root = await fs.realpath(path);
    for (const name of ['data', 'runs', '.env', 'compose.yaml']) {
      const stat = await fs.lstat(join(root, name));
      const directory = name === 'data' || name === 'runs';
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
        fail('Нужна Docker-установка с обычными data/, runs/, .env и compose.yaml без симлинков.');
      }
    }
    if (EnvFile.open(join(root, '.env')).get('LCT_MODE') === 'local') {
      fail('Обслуживание поддерживает Docker-установку; LCT_MODE=local не поддерживается.');
    }
    return root;
  },
  async lock(root) {
    const key = createHash('sha256').update(root).digest('hex').slice(0, 24);
    const path = join(await fs.realpath(homedir()), `.lct-maintenance-${key}.lock`);
    requireOutside(root, path);
    try {
      await fs.mkdir(path, { mode: 0o700 });
    } catch {
      fail(
        `Обслуживание уже запущено или недоступен lock: ${path}. После аварии проверьте процессы перед удалением lock.`,
      );
    }
    try {
      await privateDirectory(path);
    } catch (error) {
      await fs.rmdir(path);
      throw error;
    }
    return () => fs.rmdir(path);
  },
  async workspace(root) {
    const prefix = join(await fs.realpath(homedir()), '.lct-backup-');
    requireOutside(root, prefix);
    const path = await fs.mkdtemp(prefix);
    await fs.chmod(path, 0o700);
    await privateDirectory(path);
    return path;
  },
  read: (path) => fs.readFile(path, 'utf8'),
  write: (path, text) => fs.writeFile(path, text, { flag: 'wx', mode: 0o600 }),
  async publish(partial, archive) {
    const stat = await fs.lstat(partial);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      fail('Архив пуст или имеет неподходящий тип.');
    }
    await fs.chmod(partial, 0o600);
    await fs.rename(partial, archive);
  },
  remove: (path) => fs.unlink(path),
};

const defaults: MaintenanceDependencies = {
  root: repoRoot,
  platform: process.platform,
  run: runProcess,
  storage,
  log: (message) => process.stdout.write(`${message}\n`),
  healthy: waitFor,
  urls: (root) => localUrls(EnvFile.open(join(root, '.env'))),
  interrupt(cancel) {
    // Keep the parent alive so SIGINT/SIGTERM reach the restoration finally block.
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    return () => {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    };
  },
};

interface Container {
  service: string;
  id: string;
  running: boolean;
  image?: string;
}

const writers = ['web', 'api', 'engine'];
const knownServices = new Set([...writers, 'postgres', 'search', 'proxy']);

function containers(text: string): Container[] {
  const trimmed = text.trim();
  const parsed: unknown = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
  if (!Array.isArray(parsed)) fail('Не удалось прочитать состояние Docker Compose.');
  return parsed.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) fail('Некорректное состояние контейнера.');
    const value = row as Record<string, unknown>;
    if (
      typeof value.Service !== 'string' ||
      !knownServices.has(value.Service) ||
      typeof value.ID !== 'string' ||
      !/^[a-f0-9]{12,64}$/.test(value.ID) ||
      typeof value.State !== 'string' ||
      !['running', 'exited', 'created'].includes(value.State)
    ) {
      fail('Неизвестный сервис или переходное состояние Docker: обслуживание остановлено.');
    }
    return { service: value.Service, id: value.ID, running: value.State === 'running' };
  });
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Factory for isolated orchestration tests; exported commands below require no arguments. */
export function createMaintenanceCommands(overrides: Partial<MaintenanceDependencies> = {}) {
  const deps = { ...defaults, ...overrides };

  async function execute(update: boolean): Promise<number> {
    let release: (() => Promise<void>) | undefined;
    let unwatch: (() => void) | undefined;
    let cancelled = false;
    let archive: string | undefined;
    let originalCommit = '';
    let checkoutDirty = false;
    let compose: string[] = [];
    let running: Container[] = [];
    let root = '';
    let changed = false;
    const checkCancelled = () => {
      if (cancelled) fail('Обслуживание прервано; выполняется восстановление сервисов.');
    };
    const call = async (command: string[], message: string, stdoutFile?: string) => {
      checkCancelled();
      const longOperation =
        command[0] === 'corepack' ||
        command[0] === 'tar' ||
        command.includes('pg_dump') ||
        command.includes('up');
      const indicator = !overrides.run && longOperation ? spinner() : undefined;
      const label =
        command[0] === 'corepack'
          ? 'Подготавливаю зависимости и сборку'
          : command[0] === 'tar'
            ? 'Обрабатываю архив резервной копии'
            : command.includes('up')
              ? 'Собираю и запускаю сервисы'
              : 'Сохраняю базу данных';
      indicator?.start(label);
      let result;
      try {
        result = await deps.run({
          command,
          cwd: root,
          ...(command[0] === 'docker' && command[1] === 'compose' ? { installationEnv: true } : {}),
          ...(stdoutFile ? { stdoutFile } : {}),
        });
      } catch (error) {
        indicator?.error('Действие не завершено');
        throw error;
      }
      if (result.code === 0) indicator?.stop('Готово');
      else indicator?.error('Действие не завершено');
      if (result.code !== 0) fail(message);
      checkCancelled();
      return result.stdout.trim();
    };
    const dc = (args: string[], message: string) => call([...compose, ...args], message);
    const snapshot = async () =>
      containers(await dc(['ps', '--all', '--format', 'json'], 'Не удалось прочитать сервисы.'));
    const clean = async () => {
      if (
        await call(
          [
            'git',
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
            '--ignore-submodules=none',
          ],
          'Не удалось проверить Git.',
        )
      ) {
        fail(
          'Обновление требует чистого checkout: сохраните tracked и untracked изменения. Игнорируемые .env/data/runs не мешают.',
        );
      }
    };

    async function backup(): Promise<void> {
      const directory = await deps.storage.workspace(root);
      requireOutside(root, directory);
      const sql = join(directory, 'database.sql');
      const metadata = join(directory, 'metadata.json');
      const partial = join(directory, 'backup.partial.tar.gz');
      const final = join(directory, 'backup.tar.gz');
      const activeWriters = running.filter((item) => writers.includes(item.service));
      let restoreFailed = false;
      let backupFailed = false;
      let backupError: unknown;
      deps.log(
        'Создаю согласованный снимок Docker: временно останавливаю web, api и engine. Локальные процессы записи должны быть остановлены отдельно.',
      );
      try {
        // Arm finally before stop: Compose can stop some containers and still return an error.
        for (const service of writers) {
          if (activeWriters.some((item) => item.service === service)) {
            await dc(['stop', '--timeout', '60', service], `Не удалось остановить ${service}.`);
          }
        }
        const frozen = await snapshot();
        if (frozen.some((item) => item.running && writers.includes(item.service))) {
          fail('Сервисы записи продолжают работать; резервная копия отменена.');
        }
        await call(
          [
            ...compose,
            'exec',
            '-T',
            'postgres',
            'sh',
            '-c',
            'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --no-password --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
          ],
          'Не удалось выполнить pg_dump.',
          sql,
        );
        const pgVersion = await dc(
          ['exec', '-T', 'postgres', 'pg_dump', '--version'],
          'Не удалось определить версию pg_dump.',
        );
        const packageInfo = JSON.parse(
          await deps.storage.read(join(root, 'apps/cli/package.json')),
        ) as { version?: unknown };
        await deps.storage.write(
          metadata,
          `${JSON.stringify(
            {
              formatVersion: 1,
              createdAt: new Date().toISOString(),
              commit: originalCommit,
              checkoutDirty,
              codeIncluded: false,
              cliVersion: packageInfo.version,
              nodeVersion: process.version,
              pgVersion,
              containers: running,
              contents: ['data/', 'runs/', '.env', 'database.sql'],
              scope:
                'Docker installation only; external fonts, proxy certificates, search cache and host writers are not covered.',
            },
            null,
            2,
          )}\n`,
        );
        await call(
          [
            'tar',
            '--create',
            '--gzip',
            '--file',
            partial,
            '--directory',
            root,
            'data',
            'runs',
            '.env',
            '--directory',
            directory,
            'database.sql',
            'metadata.json',
          ],
          'Не удалось создать архив.',
        );
        await call(
          ['tar', '--list', '--gzip', '--file', partial],
          'Архив не прошёл проверку чтения.',
        );
        await deps.storage.publish(partial, final);
        archive = final;
      } catch (error) {
        backupFailed = true;
        backupError = error;
      } finally {
        // Docker IDs preserve the original project and never start a stopped dependency.
        for (const service of [...writers].reverse()) {
          for (const item of activeWriters.filter((container) => container.service === service)) {
            let restored = false;
            try {
              const result = await deps.run({ command: ['docker', 'start', item.id], cwd: root });
              if (result.code === 0) {
                const state = await deps.run({
                  command: ['docker', 'inspect', '--format', '{{.State.Running}}', item.id],
                  cwd: root,
                });
                restored = state.code === 0 && state.stdout.trim() === 'true';
              }
            } catch {
              restored = false;
            }
            if (!restored) {
              restoreFailed = true;
              deps.log(`Не удалось восстановить ${service}. Выполните: docker start ${item.id}`);
            }
          }
        }
        for (const path of [sql, metadata, partial]) {
          try {
            await deps.storage.remove(path);
          } catch {
            /* The private directory remains recoverable. */
          }
        }
      }
      if (restoreFailed) fail('Не все ранее работавшие контейнеры удалось запустить.');
      if (backupFailed) throw backupError;
      checkCancelled();
      deps.log(`Резервная копия (содержит секреты, права 0600): ${archive}`);
    }

    try {
      if (deps.platform !== 'linux')
        fail(
          'Обслуживание поддерживается только в Linux/Ubuntu: требуются приватные POSIX-права и GNU tar.',
        );
      root = await deps.storage.prepare(deps.root());
      release = await deps.storage.lock(root);
      unwatch = deps.interrupt(() => {
        cancelled = true;
      });
      compose = [
        'docker',
        'compose',
        '--project-directory',
        root,
        '--file',
        join(root, 'compose.yaml'),
        '--env-file',
        join(root, '.env'),
      ];
      await dc(['version'], 'Нужен установленный Docker Compose v2.');
      if (
        !(await call(['tar', '--version'], 'Нужен установленный GNU tar.')).startsWith(
          'tar (GNU tar)',
        )
      )
        fail('Нужен GNU tar.');
      const config = JSON.parse(
        await dc(['config', '--format', 'json'], 'Не удалось прочитать Compose-конфигурацию.'),
      ) as { name?: unknown };
      if (typeof config.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(config.name))
        fail('Не удалось определить Compose project.');
      compose.push('--project-name', config.name);
      running = (await snapshot()).filter((item) => item.running);
      if (!running.some((item) => item.service === 'postgres'))
        fail(
          'PostgreSQL должен быть уже запущен; остановленные сервисы автоматически не запускаются.',
        );
      for (const item of running) {
        const directory = await call(
          [
            'docker',
            'inspect',
            '--format',
            '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
            item.id,
          ],
          'Не удалось определить установку контейнера.',
        );
        if (directory !== root) fail('Контейнеры Compose принадлежат другой установке.');
        const image = await call(
          ['docker', 'inspect', '--format', '{{.Image}}', item.id],
          'Не удалось определить образ контейнера.',
        );
        if (!/^sha256:[a-f0-9]{64}$/.test(image)) fail('Некорректный идентификатор Docker image.');
        item.image = image;
      }
      for (const item of running.filter((container) => writers.includes(container.service))) {
        const mounts: unknown = JSON.parse(
          await call(
            ['docker', 'inspect', '--format', '{{json .Mounts}}', item.id],
            'Не удалось проверить хранилище контейнера.',
          ),
        );
        if (
          !Array.isArray(mounts) ||
          mounts.some(
            (mount: { RW?: boolean; Type?: string; Source?: string }) =>
              mount.RW &&
              (mount.Type !== 'bind' ||
                !['data', 'runs'].some((name) => mount.Source === join(root, name))),
          )
        ) {
          fail('У сервисов записи есть хранилище вне data/runs: такой backup не поддерживается.');
        }
      }
      originalCommit = await call(
        ['git', 'rev-parse', 'HEAD'],
        'Не удалось определить текущий commit.',
      );
      if (!/^[a-f0-9]{40,64}$/.test(originalCommit)) fail('Некорректный commit Git.');
      checkoutDirty = Boolean(
        await call(
          [
            'git',
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
            '--ignore-submodules=none',
          ],
          'Не удалось проверить состояние Git.',
        ),
      );
      let target = '';
      if (update) {
        await clean();
        await call(
          ['git', 'symbolic-ref', '--quiet', 'HEAD'],
          'Для обновления нужна ветка с upstream, не detached HEAD.',
        );
        await call(['git', 'rev-parse', '--verify', '@{upstream}'], 'У ветки не задан upstream.');
        await call(['corepack', '--version'], 'Нужен уже установленный Corepack.');
        await call(['git', 'fetch', '--no-tags'], 'Не удалось выполнить git fetch.');
        target = await call(
          ['git', 'rev-parse', '--verify', '@{upstream}^{commit}'],
          'Не удалось определить commit обновления.',
        );
        if (!/^[a-f0-9]{40,64}$/.test(target)) fail('Некорректный commit upstream.');
        await call(
          ['git', 'merge-base', '--is-ancestor', originalCommit, target],
          'Ветки разошлись или локальная ветка впереди upstream. Допускается только fast-forward.',
        );
        if (target === originalCommit) {
          deps.log('Установлена актуальная версия; обновление не требуется.');
          return 0;
        }
      }
      await backup();
      if (update) {
        await clean();
        if (
          (await call(['git', 'rev-parse', 'HEAD'], 'Не удалось проверить HEAD.')) !==
          originalCommit
        )
          fail('HEAD изменился во время резервного копирования.');
        const current = (await snapshot())
          .filter((item) => item.running)
          .map((item) => item.id)
          .sort();
        if (JSON.stringify(current) !== JSON.stringify(running.map((item) => item.id).sort()))
          fail('Состояние сервисов изменилось; повторите обновление.');
        // Everything used by the parent is already imported. Rebuilding the CLI in a child
        // does not reload or overwrite the code executing this orchestration in memory.
        changed = true;
        await call(
          ['git', 'merge', '--ff-only', '--no-overwrite-ignore', target],
          'Не удалось применить fast-forward.',
        );
        deps.log('Устанавливаю зависимости и собираю CLI. Вывод скрыт, чтобы не раскрыть секреты.');
        await call(
          ['corepack', 'yarn', 'install', '--immutable'],
          'Ошибка yarn install --immutable.',
        );
        await call(['corepack', 'yarn', 'nx', 'run', 'cli:build'], 'Ошибка сборки cli:build.');
        const services = [...new Set(running.map((item) => item.service))];
        await dc(
          ['up', '-d', '--build', '--no-deps', '--wait', '--wait-timeout', '180', ...services],
          'Контейнеры не прошли запуск/healthcheck.',
        );
        const urls = deps.urls(root);
        for (const [service, url] of [
          ['api', `${urls.api}/health`],
          ['web', urls.web],
        ] as const) {
          if (services.includes(service) && !(await deps.healthy(url)))
            fail(`Не пройдена проверка доступности ${service}.`);
          checkCancelled();
        }
        deps.log(`Обновление завершено: ${target}. Резервная копия: ${archive}`);
      }
      return 0;
    } catch (error) {
      deps.log(
        error instanceof MaintenanceError
          ? error.message
          : 'Обслуживание завершилось ошибкой; подробный вывод скрыт для защиты секретов.',
      );
      if (archive) deps.log(`Сохранённая резервная копия: ${archive}`);
      if (changed) {
        const services = [...new Set(running.map((item) => item.service))];
        deps.log(
          'Код, зависимости и контейнеры могли измениться. Автоматического отката нет. Команды восстановления кода и запуска (данные и миграции БД не откатываются):',
        );
        deps.log(
          [
            `cd ${quote(root)}`,
            `git switch --detach ${originalCommit}`,
            'corepack yarn install --immutable',
            'corepack yarn nx run cli:build',
            [...compose.map(quote), 'up -d --build --no-deps', ...services.map(quote)].join(' '),
            `# Для отдельного восстановления данных распакуйте копию в новый приватный каталог:`,
            `mkdir -m 700 ${quote(`${archive}.restore`)}`,
            `tar -xzf ${quote(archive ?? '')} -C ${quote(`${archive}.restore`)}`,
            '# database.sql восстанавливается через psql; data/, runs/ и .env — вместе с БД при остановленных writers. Перед заменой сохраните текущее состояние.',
          ].join('\n'),
        );
      }
      return 1;
    } finally {
      // The lock and signal guard outlive the restoration in backup's finally.
      try {
        await release?.();
      } catch {
        deps.log('Не удалось удалить lock обслуживания; проверьте его перед следующим запуском.');
      }
      unwatch?.();
    }
  }

  return { backupCommand: () => execute(false), updateCommand: () => execute(true) };
}

export async function backupCommand(): Promise<number> {
  return createMaintenanceCommands().backupCommand();
}

export async function updateCommand(): Promise<number> {
  return createMaintenanceCommands().updateCommand();
}
