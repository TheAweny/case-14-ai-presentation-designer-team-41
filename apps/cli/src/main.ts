#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JobEvent } from '@lct/contracts';
import { PostgresRunRepository, type RunRecord } from '@lct/run-store';
import { validateLocalRunInputs } from '@lct/input-validation';
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
  lct user admin [почта]      администратор (остальные — в интерфейсе)
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
