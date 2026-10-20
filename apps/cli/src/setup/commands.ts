import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from './ui.js';
import { EnvFile } from './env-file.js';
import { checkModel, type ModelSettings } from './models.js';
import { INSTALLATION_SECRETS, isUsableSecret } from './secrets.js';
import {
  BUILDX_HINT,
  buildxOk,
  compose,
  commandVersion,
  composeCommand,
  portFree,
  repoRoot,
  nodeVersionOk,
  runningServices,
} from './stack.js';
import { emailProblem, nameProblem, normalizeEmail, parseUsers, passwordProblem } from './users.js';
import { ask } from './terminal.js';
import { localUrls } from './settings.js';

function env(): EnvFile {
  const root = repoRoot();
  return EnvFile.open(join(root, '.env'), join(root, '.env.example'));
}

/**
 * `lct user admin [почта]` — the administrator of the installation. Other accounts are made in
 * the interface (Settings → Users); this is the way in when there is nobody to make them: the API
 * makes the account named here at start, or makes an existing one an administrator again and
 * switches it on. A password other than the one already in `.env` replaces the account's
 * password, so this also resets a forgotten one.
 */
export async function user(
  args: readonly string[],
  flags: Record<string, string>,
): Promise<number> {
  const file = env();
  const [action, target] = args;
  if (action !== 'admin') {
    const admin = file.get('ADMIN_EMAIL');
    p.log.info(
      'Аккаунты заводит администратор в интерфейсе: Настройки → Пользователи.\n' +
        `Администратор из .env: ${admin || 'не задан'}. Сменить: lct user admin [почта]`,
    );
    return action === undefined || action === 'list' ? 0 : 2;
  }
  const email = normalizeEmail(
    target ??
      String(
        await ask(() =>
          p.text({
            message: 'Почта администратора',
            validate: (v) => emailProblem(v ?? ''),
          }),
        ),
      ),
  );
  const name =
    flags.name ??
    String(
      await ask(() =>
        p.text({
          message: 'Имя',
          defaultValue: email.split('@')[0],
          placeholder: email.split('@')[0],
        }),
      ),
    );
  const password =
    flags.password ??
    String(
      await ask(() => p.password({ message: 'Пароль', validate: (v) => passwordProblem(v ?? '') })),
    );
  const problem = emailProblem(email) ?? passwordProblem(password) ?? nameProblem(name);
  if (problem) {
    p.log.error(problem);
    return 1;
  }
  file.set('ADMIN_EMAIL', email);
  file.set('ADMIN_PASSWORD', password);
  file.set('ADMIN_NAME', name);
  file.save();
  p.log.success(
    `Администратор ${email} записан в .env. Новый пароль заменит прежний при перезапуске API.`,
  );
  if (composeCommand() !== null) {
    if (runningServices().includes('api')) {
      const code = await compose(['up', '-d', 'api'], { quiet: true });
      if (code !== 0) p.log.warn('Не удалось перезапустить API: lct restart api');
    }
  }
  return 0;
}

/** `lct doctor` — what is installed, what answers, what is misconfigured. */
export async function doctor(): Promise<number> {
  p.intro('lct doctor');
  let problems = 0;
  const check = (ok: boolean, good: string, bad: string) => {
    if (ok) p.log.success(good);
    else {
      p.log.error(bad);
      problems += 1;
    }
  };
  const node = commandVersion('node');
  check(node !== null && nodeVersionOk(node), `Node ${node}`, 'Нужен Node.js 22.13+');
  const file = env();
  if (file.get('LCT_MODE') !== 'local') {
    const docker = commandVersion('docker');
    check(docker !== null, docker ?? '', 'Docker не найден. Повторите install.sh.');
    check(composeCommand() !== null, 'Docker Compose есть', 'Нет Docker Compose');
    check(buildxOk(), 'Docker buildx 0.17+ есть', BUILDX_HINT);
  }
  const uv = commandVersion('uv');
  if (uv) p.log.success(uv);
  else p.log.info('uv не найден: нужен только для локального режима');
  const free = statfsSync(repoRoot());
  const gb = (free.bavail * free.bsize) / 1e9;
  check(
    gb > 5,
    `Свободно на диске ${gb.toFixed(1)} ГБ`,
    `Мало места на диске: ${gb.toFixed(1)} ГБ, нужно от 5`,
  );

  const admin = file.get('ADMIN_EMAIL') ?? '';
  check(admin !== '', `Администратор: ${admin}`, 'Администратор не задан: lct user admin');
  check(
    !parseUsers(file.get('AUTH_USERS')).some((u) => u.email === 'demo@example.com'),
    'Демо-аккаунта из примера нет',
    'Остался demo@example.com из .env.example в AUTH_USERS: уберите его из .env',
  );
  for (const name of INSTALLATION_SECRETS) {
    check(
      isUsableSecret(file.get(name)),
      `${name} задан`,
      `${name} пуст, короткий или взят из примера: lct onboard создаст новый`,
    );
  }

  const settings = {
    MODEL_PROTOCOL: file.get('MODEL_PROTOCOL') ?? '',
    MODEL_PROVIDER: file.get('MODEL_PROVIDER') ?? '',
    LLM_BASE_URL: file.get('LLM_BASE_URL') ?? '',
    VLM_BASE_URL: file.get('VLM_BASE_URL') ?? '',
    MODEL_API_KEY: file.get('MODEL_API_KEY') ?? '',
    LLM_MODEL: file.get('LLM_MODEL') ?? '',
    VLM_MODEL: file.get('VLM_MODEL') ?? '',
    MODEL_HEADERS: file.get('MODEL_HEADERS') ?? '',
  } satisfies ModelSettings;
  const spinner = p.spinner();
  spinner.start('Проверяю модель');
  const model = await checkModel(settings);
  if (model.ok) spinner.stop(`Модель отвечает: ${model.detail}`);
  else spinner.error(`Модель не отвечает: ${model.detail}`);
  if (!model.ok) problems += 1;

  for (const [name, url] of [
    ['API', `${localUrls(file).api}/health`],
    ['веб', `${localUrls(file).web}/login`],
  ] as const) {
    const up = await fetch(url, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false);
    check(up, `${name} отвечает: ${url}`, `${name} не отвечает (${url}): lct start`);
  }
  for (const port of [
    Number(file.get('WEB_PORT') || '3000'),
    Number(file.get('API_HOST_PORT') || '3001'),
  ]) {
    if (!(await portFree(port)))
      p.log.info(`Порт ${port} занят (это нормально, если сервис запущен)`);
  }
  p.outro(problems === 0 ? 'Всё в порядке' : `Проблем: ${problems}`);
  return problems === 0 ? 0 : 1;
}

function serviceArgs(service?: string): string[] {
  if (!service) return [];
  if (!['postgres', 'engine', 'api', 'web', 'search', 'proxy'].includes(service))
    throw new Error('Сервис: postgres, engine, api, web, search или proxy.');
  return [service];
}

export const stack = {
  start: () => manageStack('Собираю и запускаю сервисы', ['up', '-d', '--build']),
  stop: () => manageStack('Останавливаю сервисы', ['down']),
  restart: (service?: string) =>
    manageStack('Перезапускаю сервисы', ['restart', ...serviceArgs(service)]),
  status: () => compose(['ps']),
  logs: (service?: string, follow = true) =>
    compose(['logs', '--tail', '100', ...(follow ? ['-f'] : []), ...serviceArgs(service)]),
};

async function manageStack(label: string, args: string[]): Promise<number> {
  const indicator = p.spinner();
  const logFile = join(repoRoot(), 'data', 'logs', 'service.log');
  indicator.start(label);
  try {
    const code = await compose(args, { logFile });
    if (code === 0) indicator.stop('Готово');
    else {
      indicator.error('Действие не завершено');
      p.log.error(`Подробности: ${logFile}`);
    }
    return code;
  } catch (error) {
    indicator.error('Действие не завершено');
    throw error;
  }
}
