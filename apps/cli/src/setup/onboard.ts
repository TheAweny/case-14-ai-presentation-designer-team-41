import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import * as p from './ui.js';
import { EnvFile } from './env-file.js';
import {
  aiStudio,
  checkModel,
  offline,
  openAiCompatible,
  projectIdProblem,
  vkAiSpace,
  type ModelSettings,
} from './models.js';
import {
  BUILDX_HINT,
  buildxOk,
  compose,
  composeCommand,
  databaseVolumeExists,
  portFree,
  repoRoot,
  run,
  runningServices,
  waitFor,
} from './stack.js';
import { emailProblem, formatUsers, nameProblem, parseUsers, passwordProblem } from './users.js';
import { ensureDatabaseSettings, ensureInstallationSecrets } from './secrets.js';
import { ask } from './terminal.js';
import {
  domainProblem,
  hostProblem,
  httpOrigin,
  installationLog,
  localUrls,
  portProblem,
  publicUrl,
  serverAddress,
  setFeatures,
} from './settings.js';

/** Answers that can come from flags, so the same setup runs without a terminal. */
export interface OnboardOptions {
  readonly yes?: boolean;
  readonly mode?: 'docker' | 'local';
  readonly provider?: 'vk' | 'ai-studio' | 'openai' | 'offline';
  readonly apiKey?: string;
  /** VK AI Space: the project the key belongs to. */
  readonly projectId?: string;
  readonly folderId?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly adminEmail?: string;
  readonly adminName?: string;
  readonly adminPassword?: string;
  readonly start?: boolean;
  readonly docs?: boolean;
  readonly search?: boolean;
  readonly domain?: string;
  readonly host?: string;
  readonly webPort?: string;
  readonly apiPort?: string;
  readonly section?: 'model' | 'settings';
}

export function modelSettings(env: EnvFile): ModelSettings {
  return {
    MODEL_PROVIDER: env.get('MODEL_PROVIDER') ?? '',
    LLM_BASE_URL: env.get('LLM_BASE_URL') ?? '',
    VLM_BASE_URL: env.get('VLM_BASE_URL') ?? '',
    MODEL_API_KEY: env.get('MODEL_API_KEY') ?? '',
    LLM_MODEL: env.get('LLM_MODEL') ?? '',
    VLM_MODEL: env.get('VLM_MODEL') ?? '',
    MODEL_HEADERS: env.get('MODEL_HEADERS') ?? '',
  };
}

async function chooseModel(options: OnboardOptions, env: EnvFile): Promise<ModelSettings> {
  if (options.yes && !options.provider) {
    if (env.get('LLM_MODEL') || env.get('MODEL_PROVIDER') === 'fake') return modelSettings(env);
    throw new Error(
      'Укажите --provider vk, ai-studio, openai или offline (только тестовые ответы).',
    );
  }
  if (options.yes) {
    if (
      (options.provider === 'vk' || options.provider === 'ai-studio') &&
      !(options.apiKey ?? process.env.LCT_MODEL_API_KEY)
    )
      throw new Error('Нужен API-ключ: LCT_MODEL_API_KEY или --api-key.');
    if (options.provider === 'vk' && !options.projectId) throw new Error('Нужен --project-id.');
    if (options.provider === 'ai-studio' && !options.folderId)
      throw new Error('Нужен --folder-id.');
    if (options.provider === 'openai' && (!options.baseUrl || !options.model))
      throw new Error('Нужны --base-url и --model.');
  }
  const provider =
    options.provider ??
    (options.yes
      ? 'offline'
      : await ask(() =>
          p.select({
            message: 'Откуда брать модель?',
            options: [
              {
                value: 'vk',
                label: 'VK AI Space',
                hint: 'Qwen 3.8 27B для финала ЛЦТ, API-ключ и Project ID',
              },
              {
                value: 'ai-studio',
                label: 'Yandex AI Studio',
                hint: 'Qwen3-30B-A3B (30.5B), ключ и ID каталога',
              },
              {
                value: 'openai',
                label: 'OpenAI-совместимый API',
                hint: 'vLLM, llama.cpp, OpenRouter…',
              },
              {
                value: 'offline',
                label: 'Тестовые ответы',
                hint: 'без модели; сборка новых колод недоступна',
              },
            ],
          }),
        ));
  if (provider === 'offline') return offline();
  if (provider === 'vk') {
    const apiKey =
      options.apiKey ??
      process.env.LCT_MODEL_API_KEY ??
      (await ask(() =>
        p.password({
          message: 'API-ключ VK AI Space',
          validate: (v) => (v && v.trim().length > 10 ? undefined : 'Вставьте ключ целиком'),
        }),
      ));
    const configured = env.get('MODEL_HEADERS')?.match(/Project-ID=([^,]+)/)?.[1];
    const projectId =
      options.projectId ??
      (await ask(() =>
        p.text({
          message: 'Project ID',
          placeholder: '0b5e…-…-…-…-…',
          ...(configured ? { defaultValue: configured } : {}),
          validate: (v) => (v === '' && configured ? undefined : projectIdProblem(v ?? '')),
        }),
      ));
    const problem = projectIdProblem(projectId || configured || '');
    if (problem) throw new Error(problem);
    return vkAiSpace(apiKey, projectId || configured || '');
  }
  if (provider === 'ai-studio') {
    const apiKey =
      options.apiKey ??
      process.env.LCT_MODEL_API_KEY ??
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
    options.apiKey ??
    process.env.LCT_MODEL_API_KEY ??
    (options.yes
      ? ''
      : await ask(() => p.password({ message: 'Ключ API (пусто, если не нужен)' })));
  const model =
    options.model ??
    (await ask(() =>
      p.text({
        message: 'Имя модели, как его называет API',
        placeholder: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
      }),
    ));
  return openAiCompatible(baseUrl, apiKey ?? '', model);
}

/**
 * The first administrator goes to ADMIN_EMAIL/ADMIN_PASSWORD. The API makes the account at start
 * and never overwrites its password afterwards; the administrator makes everyone else in the
 * interface. Accounts from the example file are known to everyone who read it: they are dropped
 * from the older AUTH_USERS list.
 */
async function createAdmin(options: OnboardOptions, env: EnvFile): Promise<string> {
  const users = parseUsers(env.get('AUTH_USERS')).filter(
    (u) =>
      u.email !== 'demo@example.com' &&
      !(u.email === 'admin@example.com' && u.password === '123123'),
  );
  env.set('AUTH_USERS', formatUsers(users));
  const configured = env.get('ADMIN_EMAIL') ?? '';
  if (configured && options.adminEmail === undefined && options.adminPassword === undefined) {
    p.log.info(`Администратор: ${configured}. Восстановление доступа: lct user admin`);
    return configured;
  }
  if (options.yes && options.adminEmail === undefined) {
    if (configured !== '') return configured;
    throw new Error('Для установки без вопросов укажите --admin-email и --admin-password.');
  }
  const email =
    options.adminEmail ??
    (await ask(() =>
      p.text({
        message: 'Почта администратора (логин в интерфейс)',
        placeholder: 'admin@example.com',
        ...(configured ? { initialValue: configured } : {}),
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
  if (options.yes && password === undefined)
    throw new Error(
      'Для установки без вопросов нужен --admin-password или LCT_INSTALL_ADMIN_PASSWORD.',
    );
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
  env.set('ADMIN_EMAIL', email.trim().toLowerCase());
  env.set('ADMIN_PASSWORD', password);
  env.set('ADMIN_NAME', name);
  return email;
}

/**
 * The setup wizard: mode, model with a live check, the first account, ports, then the stack is
 * started and awaited. Every answer can come from a flag, and `--yes` takes the defaults, so the
 * same path runs in CI and in a terminal.
 */
async function configureAccess(options: OnboardOptions, env: EnvFile): Promise<void> {
  const access =
    options.domain !== undefined
      ? options.domain
        ? 'domain'
        : 'ip'
      : options.host !== undefined
        ? 'ip'
        : options.yes
          ? env.get('LCT_DOMAIN')
            ? 'domain'
            : 'ip'
          : await ask(() =>
              p.select({
                message: 'Как открывать приложение?',
                initialValue: env.get('LCT_DOMAIN') ? 'domain' : 'ip',
                options: [
                  {
                    value: 'ip',
                    label: 'По IP сервера',
                    hint: 'HTTP; домен можно подключить позже',
                  },
                  {
                    value: 'domain',
                    label: 'По домену',
                    hint: 'HTTPS и автоматическое продление сертификата',
                  },
                ],
              }),
            );
  const domain =
    access === 'domain'
      ? (options.domain ??
        (options.yes
          ? (env.get('LCT_DOMAIN') ?? '')
          : await ask(() =>
              p.text({
                message: 'Домен приложения',
                initialValue: env.get('LCT_DOMAIN') ?? '',
                placeholder: 'slides.example.com',
                validate: (v) => domainProblem(v ?? ''),
              }),
            )))
      : '';
  if (domain && domainProblem(domain)) throw new Error(domainProblem(domain));
  const webPort =
    options.webPort ??
    (options.yes || domain
      ? env.get('WEB_PORT') || '3000'
      : await ask(() =>
          p.text({
            message: 'Порт приложения',
            defaultValue: env.get('WEB_PORT') || '3000',
            placeholder: '3000',
            validate: (v) => portProblem(v ?? ''),
          }),
        ));
  const apiPort = options.apiPort ?? env.get('API_HOST_PORT') ?? '3001';
  for (const port of [webPort, apiPort]) if (portProblem(port)) throw new Error(portProblem(port));
  if (
    webPort === apiPort ||
    (domain && [webPort, apiPort].some((port) => ['80', '443'].includes(port)))
  )
    throw new Error(
      'Порты приложения и API должны различаться; для HTTPS порты 80 и 443 занимает прокси.',
    );
  env.set('WEB_PORT', webPort);
  env.set('API_HOST_PORT', apiPort);
  env.set('WEB_BIND', domain ? '127.0.0.1' : '0.0.0.0');
  env.set('LCT_DOMAIN', domain.toLowerCase());
  const host = domain
    ? ''
    : (options.host ??
      (options.yes
        ? env.get('LCT_PUBLIC_HOST') ||
          (env.get('LCT_MODE') === 'local' ? 'localhost' : serverAddress())
        : await ask(() =>
            p.text({
              message: 'IP сервера, по которому вы откроете приложение',
              defaultValue:
                env.get('LCT_PUBLIC_HOST') ||
                (env.get('LCT_MODE') === 'local' ? 'localhost' : serverAddress()),
              validate: (value) => hostProblem(value ?? ''),
            }),
          )));
  if (host && hostProblem(host)) throw new Error(hostProblem(host));
  env.set('LCT_PUBLIC_HOST', host);
  env.set('APP_ORIGIN', domain ? `https://${domain.toLowerCase()}` : httpOrigin(host, webPort));
  env.set('SESSION_COOKIE_SECURE', String(Boolean(domain)));
  const profiles = new Set((env.get('COMPOSE_PROFILES') ?? '').split(',').filter(Boolean));
  if (domain) profiles.add('https');
  else profiles.delete('https');
  env.set('COMPOSE_PROFILES', [...profiles].join(','));
  if (domain)
    p.log.info(
      'DNS домена должен указывать на сервер. Для сертификата нужны открытые порты 80 и 443.',
    );
  const docs =
    options.docs ??
    (options.yes
      ? env.get('API_DOCS_ENABLED') === 'true'
      : await ask(() =>
          p.confirm({
            message: 'Включить документацию API?',
            initialValue: env.get('API_DOCS_ENABLED') === 'true',
            active: 'Да',
            inactive: 'Нет',
          }),
        ));
  const search =
    options.search ??
    (options.yes
      ? env.get('WEB_SEARCH_URL') !== ''
      : await ask(() =>
          p.confirm({
            message: 'Включить поиск в интернете?',
            initialValue: env.get('WEB_SEARCH_URL') !== '',
            active: 'Да',
            inactive: 'Нет',
          }),
        ));
  setFeatures(env, docs, search);
}

export async function onboard(input: OnboardOptions = {}): Promise<number> {
  const options = {
    ...input,
    adminPassword: input.adminPassword ?? process.env.LCT_INSTALL_ADMIN_PASSWORD,
  };
  const root = repoRoot();
  const fresh = !existsSync(join(root, '.env'));
  const env = EnvFile.open(join(root, '.env'), join(root, '.env.example'));
  p.intro(`LCT · ${fresh ? 'установка' : 'настройка'}`);
  const mode = options.mode ?? env.get('LCT_MODE') ?? 'docker';
  if (!['docker', 'local'].includes(mode)) throw new Error('Режим: --mode docker или local.');
  env.set('LCT_MODE', mode);
  if (mode === 'docker' && composeCommand() === null) {
    p.log.error('Нужен Docker с Compose: https://docs.docker.com/get-docker/');
    return 1;
  }
  if (mode === 'docker' && !buildxOk()) {
    p.log.error(BUILDX_HINT);
    return 1;
  }

  if (mode === 'docker' && options.start !== false) {
    const ready = await run(['docker', 'info'], { quiet: true });
    if (ready !== 0)
      throw new Error('Docker не отвечает. Проверьте службу Docker и права доступа.');
  }
  const running = mode === 'docker' ? runningServices() : [];
  const existingDatabase =
    mode === 'docker' && (running.includes('postgres') || databaseVolumeExists());
  if (fresh && existingDatabase)
    throw new Error(
      'Обнаружена работающая БД без .env. Восстановите файл настроек из резервной копии.',
    );
  p.log.step('1 / 4 · Подключение модели');
  const keepModel =
    !fresh &&
    !options.provider &&
    options.section !== 'model' &&
    Boolean(env.get('LLM_MODEL') || env.get('MODEL_PROVIDER'));
  let settings = keepModel ? modelSettings(env) : await chooseModel(options, env);
  const spinner = p.spinner();
  while (options.section !== 'settings' || !keepModel) {
    spinner.start('Проверяю подключение');
    const check = await checkModel(settings);
    if (check.ok) spinner.stop(`Подключение: ${check.detail}`);
    else spinner.error('Модель не ответила');
    if (check.ok) break;
    p.log.warn(check.detail);
    if (options.yes)
      throw new Error('Подключение к модели не прошло проверку. Настройки не сохранены.');
    const action = await ask(() =>
      p.select({
        message: 'Что сделать?',
        options: [
          { value: 'retry', label: 'Изменить подключение' },
          { value: 'save', label: 'Сохранить и подключить позже' },
          { value: 'cancel', label: 'Завершить настройку' },
        ],
      }),
    );
    if (action === 'save') break;
    if (action === 'cancel') return 1;
    settings = await chooseModel({}, env);
  }
  for (const [key, value] of Object.entries(settings)) env.set(key, value);
  if (settings.MODEL_PROVIDER === 'fake')
    p.log.warn('Тестовые ответы: для генерации новых презентаций подключите модель через lct.');
  p.log.step('2 / 4 · Администратор');
  const admin = await createAdmin(options, env);
  p.log.step('3 / 4 · Доступ и возможности');
  if (options.section !== 'model') await configureAccess(options, env);
  const ports = [
    { service: 'web', port: Number(env.get('WEB_PORT') || '3000') },
    { service: 'api', port: Number(env.get('API_HOST_PORT') || '3001') },
    { service: 'postgres', port: Number(env.get('POSTGRES_PORT') || '5433') },
    ...(env.get('LCT_DOMAIN')
      ? [
          { service: 'proxy', port: 80 },
          { service: 'proxy', port: 443 },
        ]
      : []),
  ];
  if (mode === 'docker')
    for (const { service, port } of ports) {
      if (!(await portFree(port)) && !running.includes(service))
        throw new Error(`Порт ${port} занят. Освободите его или выберите другой в мастере.`);
    }
  const created = ensureInstallationSecrets(env);
  const databaseCreated = ensureDatabaseSettings(
    env,
    fresh ||
      (mode === 'docker' &&
        !existingDatabase &&
        (!env.get('POSTGRES_PASSWORD') || env.get('POSTGRES_PASSWORD') === 'lct26-local')),
  );
  if (created.length || databaseCreated) p.log.success('Созданы индивидуальные секреты установки');
  p.note(
    `Адрес: ${publicUrl(env)}\nАдминистратор: ${admin}\nДокументация API: ${env.get('API_DOCS_ENABLED') === 'true' ? 'включена' : 'выключена'}\nВеб-поиск: ${env.get('WEB_SEARCH_URL') ? 'включён' : 'выключен'}\nКаталог: ${root}`,
    'Параметры установки',
  );
  if (
    !options.yes &&
    !(await ask(() =>
      p.confirm({ message: 'Сохранить настройки?', active: 'Сохранить', inactive: 'Отмена' }),
    ))
  )
    return 0;
  env.save();
  for (const directory of ['data', 'runs', 'data/fonts'])
    mkdirSync(join(root, directory), { recursive: true });
  p.log.success('Настройки сохранены в .env');

  const start =
    options.start ??
    (options.yes
      ? true
      : await ask(() =>
          p.confirm({
            message: 'Применить настройки и запустить сервис?',
            active: 'Запустить',
            inactive: 'Позже',
          }),
        ));
  if (!start) {
    p.outro(
      mode === 'docker'
        ? 'Готово. Запуск: lct start'
        : 'Настроено для разработки. Команды запуска: lct help',
    );
    return 0;
  }
  if (mode === 'local') {
    spinner.start('Ставлю зависимости: yarn и uv');
    const code =
      (await run(['corepack', 'yarn', 'install', '--immutable'], { quiet: true })) ||
      (await run(['uv', 'sync'], { quiet: true }));
    if (code === 0) spinner.stop('Зависимости на месте');
    else spinner.error('Не удалось поставить зависимости');
    p.outro(
      'Запуск: uv run uvicorn engine.api:app --port 8000, yarn nx run api:serve, yarn nx run web:serve',
    );
    return code;
  }
  p.log.step('4 / 4 · Запуск');
  const logFile = installationLog(root);
  spinner.start('Собираю и запускаю сервисы · первая сборка занимает несколько минут');
  const disabled = running.filter(
    (name) =>
      (name === 'search' && !env.get('WEB_SEARCH_URL')) ||
      (name === 'proxy' && !env.get('LCT_DOMAIN')),
  );
  if (disabled.length) {
    const stopped = await compose(['stop', ...disabled], { logFile });
    if (stopped !== 0) {
      spinner.error('Не удалось остановить отключённые сервисы');
      return stopped;
    }
  }
  const code = await compose(['up', '-d', '--build'], { logFile });
  if (code === 0) spinner.stop('Контейнеры запущены');
  else spinner.error('Запуск не завершён');
  if (code !== 0) {
    p.log.error(`Подробности: ${logFile}\nПовторить: lct start. Диагностика: lct doctor`);
    return code;
  }
  spinner.start('Жду, пока сервис ответит');
  const urls = localUrls(env);
  const checks = await Promise.all([waitFor(`${urls.api}/health`), waitFor(`${urls.web}/login`)]);
  const up = checks.every(Boolean);
  if (up) spinner.stop('Сервис запущен');
  else spinner.error('Сервис не ответил за 3 минуты');
  p.note(
    `Приложение: ${publicUrl(env)}\nВход: ${admin}\n\nУправление: lct\nДиагностика: lct doctor\nЛоги установки: ${logFile}`,
    up ? 'Готово' : 'Проверьте',
  );
  if (up && env.get('LCT_DOMAIN')) {
    spinner.start('Проверяю HTTPS домена');
    const https = await waitFor(`${publicUrl(env)}/login`, 60);
    if (https) spinner.stop('HTTPS готов');
    else spinner.stop('Сервис запущен · внешний HTTPS пока не подтверждён');
    if (!https) {
      p.log.warn(
        'Сервис работает локально, но HTTPS не удалось проверить с этого сервера. ' +
          'Выпуск сертификата может занять больше времени, а внешний адрес может быть недоступен изнутри. ' +
          'Откройте адрес в браузере, проверьте DNS и порты 80/443. Подробности: lct logs proxy',
      );
    }
  }
  p.outro(up ? 'Установка готова · управление: lct' : 'lct doctor подскажет, что не так');
  return up ? 0 : 1;
}
