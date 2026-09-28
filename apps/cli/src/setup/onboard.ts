import { join } from 'node:path';
import * as p from '@clack/prompts';
import { EnvFile } from './env-file.js';
import { aiStudio, checkModel, offline, openAiCompatible, type ModelSettings } from './models.js';
import {
  BUILDX_HINT,
  buildxOk,
  compose,
  composeCommand,
  portFree,
  repoRoot,
  run,
  waitFor,
} from './stack.js';
import {
  emailProblem,
  formatUsers,
  nameProblem,
  parseUsers,
  passwordProblem,
  upsertUser,
} from './users.js';
import { ensureInstallationSecrets } from './secrets.js';

/** Answers that can come from flags, so the same setup runs without a terminal. */
export interface OnboardOptions {
  readonly yes?: boolean;
  readonly mode?: 'docker' | 'local';
  readonly provider?: 'ai-studio' | 'openai' | 'offline';
  readonly apiKey?: string;
  readonly folderId?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly adminEmail?: string;
  readonly adminName?: string;
  readonly adminPassword?: string;
  readonly start?: boolean;
}

function cancelled(value: unknown): never | void {
  if (p.isCancel(value)) {
    p.cancel('Установка прервана. Можно продолжить позже: lct onboard');
    process.exit(1);
  }
}

async function ask<T>(prompt: () => Promise<T | symbol>): Promise<T> {
  const value = await prompt();
  cancelled(value);
  return value as T;
}

async function chooseModel(options: OnboardOptions, env: EnvFile): Promise<ModelSettings> {
  const provider =
    options.provider ??
    (options.yes
      ? 'offline'
      : await ask(() =>
          p.select({
            message: 'Откуда брать модель?',
            options: [
              {
                value: 'ai-studio',
                label: 'Yandex AI Studio',
                hint: 'Qwen3.6-35B-A3B, ключ и ID каталога',
              },
              {
                value: 'openai',
                label: 'OpenAI-совместимый API',
                hint: 'vLLM, llama.cpp, OpenRouter…',
              },
              { value: 'offline', label: 'Офлайн', hint: 'записанные ответы, без сети и ключа' },
            ],
          }),
        ));
  if (provider === 'offline') return offline();
  if (provider === 'ai-studio') {
    const apiKey =
      options.apiKey ??
      (await ask(() =>
        p.password({
          message: 'API-ключ AI Studio',
          validate: (v) => (v && v.length > 10 ? undefined : 'Вставьте ключ целиком'),
        }),
      ));
    const folderId =
      options.folderId ??
      (await ask(() =>
        p.text({
          message: 'ID каталога Yandex Cloud',
          placeholder: 'b1g…',
          defaultValue: env.get('LLM_MODEL')?.split('/')[2],
          validate: (v) =>
            /^b1g[a-z0-9]{17}$/.test(v ?? '') ? undefined : 'ID каталога: b1g и 17 символов',
        }),
      ));
    return aiStudio(apiKey, folderId);
  }
  const baseUrl =
    options.baseUrl ??
    (await ask(() =>
      p.text({
        message: 'Base URL API (заканчивается на /v1)',
        placeholder: 'http://localhost:8080/v1',
        validate: (v) =>
          /^https?:\/\/.+\/v\d/.test(v ?? '') ? undefined : 'Адрес вида https://host/v1',
      }),
    ));
  const apiKey =
    options.apiKey ?? (await ask(() => p.password({ message: 'Ключ API (пусто, если не нужен)' })));
  const model =
    options.model ??
    (await ask(() =>
      p.text({ message: 'Имя модели, как его называет API', placeholder: 'Qwen/Qwen3.6-35B-A3B' }),
    ));
  return openAiCompatible(baseUrl, apiKey ?? '', model);
}

async function createAdmin(options: OnboardOptions, env: EnvFile): Promise<string> {
  // Accounts from the example file are known to everyone who read it: they never survive setup.
  const users = parseUsers(env.get('AUTH_USERS')).filter(
    (u) =>
      u.email !== 'demo@example.com' &&
      !(u.email === 'admin@example.com' && u.password === '123123'),
  );
  if (options.yes && options.adminEmail === undefined) {
    if (users.length > 0) return users[0]?.email ?? '';
    throw new Error('Для установки без вопросов укажите --admin-email и --admin-password.');
  }
  const email =
    options.adminEmail ??
    (await ask(() =>
      p.text({
        message: 'Почта администратора (логин в интерфейс)',
        placeholder: 'admin@example.com',
        validate: (v) => emailProblem(v ?? ''),
      }),
    ));
  const name =
    options.adminName ??
    (options.yes
      ? (email.split('@')[0] ?? 'Admin')
      : await ask(() =>
          p.text({
            message: 'Имя',
            defaultValue: email.split('@')[0],
            placeholder: email.split('@')[0],
            validate: (v) => (v ? nameProblem(v) : undefined),
          }),
        ));
  let password = options.adminPassword;
  if (password === undefined) {
    password = await ask(() =>
      p.password({ message: 'Пароль', validate: (v) => passwordProblem(v ?? '') }),
    );
    const again = await ask(() => p.password({ message: 'Пароль ещё раз' }));
    if (again !== password) {
      p.log.error('Пароли не совпали');
      return createAdmin(options, env);
    }
  }
  const problem = emailProblem(email) ?? passwordProblem(password) ?? nameProblem(name);
  if (problem) throw new Error(problem);
  env.set('AUTH_USERS', formatUsers(upsertUser(users, { email, password, name })));
  return email;
}

/**
 * The setup wizard: mode, model with a live check, the first account, ports, then the stack is
 * started and awaited. Every answer can come from a flag, and `--yes` takes the defaults, so the
 * same path runs in CI and in a terminal.
 */
export async function onboard(options: OnboardOptions = {}): Promise<number> {
  const root = repoRoot();
  const env = EnvFile.open(join(root, '.env'), join(root, '.env.example'));
  p.intro('Цифровой дизайнер презентаций · установка');

  const mode =
    options.mode ??
    (options.yes
      ? 'docker'
      : await ask(() =>
          p.select({
            message: 'Как запускать сервис?',
            options: [
              {
                value: 'docker',
                label: 'Docker Compose',
                hint: 'рекомендуется: всё в контейнерах',
              },
              {
                value: 'local',
                label: 'Локально',
                hint: 'для разработки: yarn, uv, Node 22, Python 3.12',
              },
            ],
          }),
        ));
  if (mode === 'docker' && composeCommand() === null) {
    p.log.error('Нужен Docker с Compose: https://docs.docker.com/get-docker/');
    return 1;
  }
  if (mode === 'docker' && !buildxOk()) {
    p.log.error(BUILDX_HINT);
    return 1;
  }

  const settings = await chooseModel(options, env);
  const spinner = p.spinner();
  spinner.start('Проверяю модель');
  const check = await checkModel(settings);
  spinner.stop(
    check.ok ? `Модель отвечает: ${check.detail}` : `Модель не ответила: ${check.detail}`,
  );
  if (!check.ok && !options.yes) {
    const keep = await ask(() =>
      p.confirm({ message: 'Сохранить настройки всё равно?', initialValue: false }),
    );
    if (!keep) return chooseModelAgain(options);
  }
  for (const [key, value] of Object.entries(settings)) env.set(key, value);

  const admin = await createAdmin(options, env);

  for (const [key, port] of [
    ['web', 3000],
    ['API', 3001],
  ] as const) {
    if (!(await portFree(port)))
      p.log.warn(`Порт ${port} (${key}) занят: освободите его перед запуском`);
  }
  const created = ensureInstallationSecrets(env);
  if (created.length > 0) p.log.success(`Созданы секреты этой установки: ${created.join(', ')}`);
  env.save();
  p.log.success('Настройки записаны в .env (доступен только вам)');

  const start =
    options.start ??
    (options.yes ? true : await ask(() => p.confirm({ message: 'Запустить сервис сейчас?' })));
  if (!start) {
    p.outro(
      mode === 'docker'
        ? 'Готово. Запуск: lct start'
        : 'Готово. Запуск: см. README, раздел «Локальный запуск»',
    );
    return 0;
  }
  if (mode === 'local') {
    spinner.start('Ставлю зависимости: yarn и uv');
    const code =
      (await run(['corepack', 'yarn', 'install', '--immutable'], { quiet: true })) ||
      (await run(['uv', 'sync'], { quiet: true }));
    spinner.stop(code === 0 ? 'Зависимости на месте' : 'Не удалось поставить зависимости');
    p.outro(
      'Запуск: uv run uvicorn engine.api:app --port 8000, yarn nx run api:serve, yarn nx run web:serve',
    );
    return code;
  }
  p.log.step('Собираю и запускаю контейнеры, первая сборка занимает несколько минут');
  const code = await compose(['up', '-d', '--build']);
  if (code !== 0) {
    p.log.error('docker compose не поднялся: lct logs покажет почему');
    return code;
  }
  spinner.start('Жду, пока сервис ответит');
  const up =
    (await waitFor('http://localhost:3001/health')) && (await waitFor('http://localhost:3000'));
  spinner.stop(up ? 'Сервис запущен' : 'Сервис не ответил за 3 минуты');
  p.note(
    `Интерфейс:  http://localhost:3000\nВход:       ${admin}\nAPI:        http://localhost:3001\n\nlct status · lct logs · lct user add · lct stop`,
    up ? 'Готово' : 'Проверьте',
  );
  p.outro(up ? 'Хорошей работы' : 'lct doctor подскажет, что не так');
  return up ? 0 : 1;
}

function chooseModelAgain(options: OnboardOptions): Promise<number> {
  return onboard({ ...options, provider: undefined, apiKey: undefined, folderId: undefined });
}
