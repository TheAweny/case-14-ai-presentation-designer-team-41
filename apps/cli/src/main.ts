#!/usr/bin/env node
import { PostgresRunRepository, type RunRecord } from '@lct/run-store';
import { readRunConfig } from './config.js';
import { generateFromConfig } from './generate.js';
import { parseArgs } from './setup/args.js';
import { doctor, stack, user } from './setup/commands.js';
import { onboard } from './setup/onboard.js';

const HELP = `lct — цифровой дизайнер презентаций

  lct onboard                 мастер установки: режим, модель, администратор, запуск
  lct start | stop | status   сервис в Docker Compose
  lct restart [сервис]        перезапуск, например lct restart web
  lct logs [сервис]           логи
  lct user list               аккаунты интерфейса
  lct user add [почта]        новый аккаунт
  lct user passwd <почта>     сменить пароль
  lct user remove <почта>     удалить аккаунт
  lct doctor                  проверить окружение, модель и сервис
  lct generate <config.yaml>  сгенерировать колоды по конфигу прогона

Установка без вопросов:
  lct onboard --yes --provider ai-studio --api-key KEY --folder-id b1g… \\
    --admin-email you@example.com --admin-password '…'
`;

const COMMANDS: Record<string, (args: string[], flags: Record<string, string>) => Promise<number>> =
  {
    onboard: (_args, f) =>
      onboard({
        yes: f.yes === 'true',
        mode: f.mode as 'docker' | 'local' | undefined,
        provider: f.provider as 'ai-studio' | 'openai' | 'offline' | undefined,
        apiKey: f['api-key'],
        folderId: f['folder-id'],
        baseUrl: f['base-url'],
        model: f.model,
        adminEmail: f['admin-email'],
        adminName: f['admin-name'],
        adminPassword: f['admin-password'],
        ...(f['no-start'] ? { start: false } : {}),
      }),
    start: () => stack.start(),
    stop: () => stack.stop(),
    restart: (args) => stack.restart(args[0]),
    status: () => stack.status(),
    logs: (args) => stack.logs(args[0]),
    user: (args, f) => user(args, f),
    doctor: () => doctor(),
  };

export async function initializeRun(
  configPath: string,
  connectionString = process.env.DATABASE_URL,
  createId?: () => string,
): Promise<RunRecord> {
  readRunConfig(configPath);
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  const repository = new PostgresRunRepository({ connectionString, createId });
  try {
    await repository.migrate();
    return await repository.create();
  } finally {
    await repository.close();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv.slice(2);
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return command === undefined ? 2 : 0;
  }
  const handler = COMMANDS[command];
  if (handler !== undefined) {
    const { args, flags } = parseArgs(rest);
    try {
      return await handler(args, flags);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (argv[2] === 'generate') {
    const path = argv[3];
    if (path === undefined) {
      process.stderr.write('Usage: lct generate <path-to-run-config.yaml>\n');
      return 2;
    }
    try {
      const result = await generateFromConfig({ config: readRunConfig(path), configPath: path });
      return result.variants.length > 0 ? 0 : 1;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
