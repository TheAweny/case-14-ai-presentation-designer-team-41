#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JobEvent } from '@lct/contracts';
import { PostgresRunRepository, type RunRecord } from '@lct/run-store';
import { validateLocalRunInputs } from '@lct/input-validation';
import { readRunConfig } from './config.js';
import { parseArgs } from './setup/args.js';
import { doctor, stack, user } from './setup/commands.js';
import { onboard, type OnboardOptions } from './setup/onboard.js';
import { menu } from './setup/menu.js';
import { userCommand, usersMenu } from './setup/user-command.js';
import { backupCommand, updateCommand } from './setup/maintenance.js';
import { Cancelled } from './setup/terminal.js';

const HELP = `lct — цифровой дизайнер презентаций

  lct                         интерактивное меню управления
  lct onboard                 мастер установки: режим, модель, администратор, запуск
  lct configure               домен, порты, документация API, веб-поиск
  lct model                   подключение модели
  lct start | stop | status   сервис в Docker Compose
  lct restart [сервис]        перезапуск, например lct restart web
  lct logs [сервис]           логи
  lct user                    меню пользователей
  lct user list               список пользователей
  lct user add [почта]         создать пользователя
  lct user role [почта]        изменить роль (--role user|admin)
  lct user disable|enable [почта]  заблокировать или включить
  lct user password [почта]    сбросить пароль
  lct user revoke-sessions [почта]  завершить сессии
  lct user admin [почта]       восстановить администратора
  lct backup                  резервная копия файлов, настроек и БД
  lct update                  резервная копия и обновление сервиса
  lct doctor                  проверить окружение, модель и сервис
  lct generate <config.yaml>  собрать колоды по конфигу прогона, как в интерфейсе

Установка без вопросов, модель финала VK AI Space:
  lct onboard --yes --provider vk --api-key KEY --project-id UUID \\
    --admin-email admin@example.com --admin-password '…'

Или Yandex AI Studio:
  lct onboard --yes --provider ai-studio --api-key KEY --folder-id b1g… \\
    --admin-email you@example.com --admin-password '…'

Настройки: --domain slides.example.com (HTTPS) или --host IP (HTTP),
  --web-port 3000, --api-port 3001,
  --docs / --no-docs, --search / --no-search, --no-start.
Ключи можно передать через LCT_MODEL_API_KEY и LCT_INSTALL_ADMIN_PASSWORD.
Для команд пользователей: --login-email и LCT_ADMIN_PASSWORD (актуальный пароль).
Локальная разработка: --mode local; uv run uvicorn engine.api:app --port 8000,
  yarn nx run api:serve, yarn nx run web:serve.
`;

export function onboardOptions(f: Record<string, string>): OnboardOptions {
  if (f.mode && !['docker', 'local'].includes(f.mode)) throw new Error('Режим: docker или local.');
  if (f.provider && !['vk', 'ai-studio', 'openai', 'offline'].includes(f.provider))
    throw new Error('Провайдер: vk, ai-studio, openai или offline.');
  const toggle = (name: string): boolean | undefined => {
    if (f[`no-${name}`] !== undefined && f[name] !== undefined)
      throw new Error(`Выберите один флаг: --${name} или --no-${name}.`);
    if (f[`no-${name}`] !== undefined) return false;
    if (f[name] === undefined) return undefined;
    if (!['true', 'false'].includes(f[name] ?? '')) throw new Error(`--${name}: true или false.`);
    return f[name] === 'true';
  };
  return {
    yes: f.yes === 'true',
    mode: f.mode as OnboardOptions['mode'],
    provider: f.provider as OnboardOptions['provider'],
    apiKey: f['api-key'],
    projectId: f['project-id'],
    folderId: f['folder-id'],
    baseUrl: f['base-url'],
    model: f.model,
    adminEmail: f['admin-email'],
    adminName: f['admin-name'],
    adminPassword: f['admin-password'],
    domain: f.domain,
    host: f.host,
    webPort: f['web-port'],
    apiPort: f['api-port'],
    docs: toggle('docs'),
    search: toggle('search'),
    ...(f['no-start'] ? { start: false } : {}),
  };
}

const COMMANDS: Record<string, (args: string[], flags: Record<string, string>) => Promise<number>> =
  {
    onboard: (_args, f) => onboard(onboardOptions(f)),
    configure: (_args, f) => onboard({ ...onboardOptions(f), section: 'settings' }),
    model: (_args, f) => onboard({ ...onboardOptions(f), section: 'model' }),
    menu: () => menu(),
    backup: () => backupCommand(),
    update: () => updateCommand(),
    start: () => stack.start(),
    stop: () => stack.stop(),
    restart: (args) => stack.restart(args[0]),
    status: () => stack.status(),
    logs: (args) => stack.logs(args[0]),
    user: async (args, f) => {
      if (!args.length && process.stdin.isTTY && process.stdout.isTTY) {
        await usersMenu();
        return 0;
      }
      return args[0] === 'admin' ? user(args, f) : userCommand(args, f);
    },
    doctor: () => doctor(),
  };

export async function initializeRun(
  configPath: string,
  connectionString = process.env.DATABASE_URL,
  createId?: () => string,
): Promise<RunRecord> {
  const config = readRunConfig(configPath);
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  validateLocalRunInputs(config);
  const repository = new PostgresRunRepository({ connectionString, createId });
  try {
    await repository.migrate();
    return await repository.create();
  } finally {
    await repository.close();
  }
}

export async function readRunEvents(
  runId: string,
  connectionString = process.env.DATABASE_URL,
  afterSequence = -1,
): Promise<readonly JobEvent[]> {
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  const repository = new PostgresRunRepository({ connectionString });
  try {
    await repository.migrate();
    return await repository.events(runId, afterSequence);
  } finally {
    await repository.close();
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv.slice(2);
  if (command === undefined && process.stdin.isTTY && process.stdout.isTTY) {
    try {
      return await menu();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return error instanceof Cancelled ? 130 : 1;
    }
  }
  if (
    command === undefined ||
    command === 'help' ||
    command === '--help' ||
    command === '-h' ||
    rest.includes('--help')
  ) {
    process.stdout.write(HELP);
    return 0;
  }
  const handler = COMMANDS[command];
  if (handler !== undefined) {
    const { args, flags } = parseArgs(rest);
    try {
      return await handler(args, flags);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return error instanceof Cancelled ? 130 : 1;
    }
  }
  if (argv[2] === 'generate') {
    const path = argv[3];
    if (!path) {
      process.stderr.write('Usage: lct generate <path-to-run-config.yaml>\n');
      return 2;
    }
    try {
      const { generateCommand } = await import('./generate-command.js');
      return await generateCommand(path);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  const configPath = argv[2];
  if (configPath === undefined) {
    process.stderr.write('Usage: lct <path-to-run-config.yaml> | lct generate <config.yaml>\n');
    return 2;
  }

  try {
    const run = await initializeRun(configPath);
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/** Run when this file is the entry point, including through a symlink such as ~/.local/bin/lct. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
