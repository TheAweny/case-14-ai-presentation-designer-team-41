import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import { EnvFile } from './env-file.js';
import { checkModel, type ModelSettings } from './models.js';
import {
  BUILDX_HINT,
  buildxOk,
  compose,
  commandVersion,
  composeCommand,
  portFree,
  repoRoot,
} from './stack.js';
import {
  emailProblem,
  formatUsers,
  nameProblem,
  normalizeEmail,
  parseUsers,
  passwordProblem,
  upsertUser,
} from './users.js';

function env(): EnvFile {
  const root = repoRoot();
  return EnvFile.open(join(root, '.env'), join(root, '.env.example'));
}

/**
 * The API loads AUTH_USERS into its accounts table when it starts, so a running stack picks a
 * change up by recreating the API (and the web, which reads the same file). Stopped, nothing to
 * do: the next start loads the list.
 */
async function applyAccounts(): Promise<void> {
  if (composeCommand() === null) return;
  const running = await compose(['ps', '--status', 'running', '--services'], { quiet: true })
    .then((code) => code === 0)
    .catch(() => false);
  if (!running) return;
  const spinner = p.spinner();
  spinner.start('Применяю аккаунты в запущенном сервисе');
  const code = await compose(['up', '-d', 'api', 'web'], { quiet: true });
  spinner.stop(code === 0 ? 'Аккаунты применены' : 'Не удалось перезапустить API: lct restart api');
}

/** `lct user add|list|remove|passwd` — accounts of the web interface. */
export async function user(
  args: readonly string[],
  flags: Record<string, string>,
): Promise<number> {
  const file = env();
  const users = parseUsers(file.get('AUTH_USERS'));
  const [action, target] = args;
  if (action === 'list' || action === undefined) {
    if (users.length === 0) p.log.warn('Аккаунтов нет: lct user add');
    for (const u of users) p.log.message(`${u.email}  ${u.name}`);
    return 0;
  }
  if (action === 'remove') {
    const email = normalizeEmail(target ?? '');
    if (!users.some((u) => u.email === email)) {
      p.log.error(`Нет аккаунта ${email}`);
      return 1;
    }
    file.set('AUTH_USERS', formatUsers(users.filter((u) => u.email !== email)));
    file.save();
    p.log.success(`Удалён ${email}`);
    await applyAccounts();
    return 0;
  }
  if (action === 'add' || action === 'passwd') {
    const email = normalizeEmail(
      target ?? String(await p.text({ message: 'Почта', validate: (v) => emailProblem(v ?? '') })),
    );
    const known = users.find((u) => u.email === email);
    if (action === 'passwd' && !known) {
      p.log.error(`Нет аккаунта ${email}`);
      return 1;
    }
    const name =
      flags.name ??
      known?.name ??
      String(
        await p.text({
          message: 'Имя',
          defaultValue: email.split('@')[0],
          placeholder: email.split('@')[0],
        }),
      );
    const password =
      flags.password ??
      String(await p.password({ message: 'Пароль', validate: (v) => passwordProblem(v ?? '') }));
    const problem = emailProblem(email) ?? passwordProblem(password) ?? nameProblem(name);
    if (problem) {
      p.log.error(problem);
      return 1;
    }
    file.set('AUTH_USERS', formatUsers(upsertUser(users, { email, name, password })));
    file.save();
    p.log.success(action === 'add' ? `Аккаунт ${email} создан` : `Пароль ${email} изменён`);
    await applyAccounts();
    return 0;
  }
  p.log.error('lct user list | add [почта] | remove <почта> | passwd <почта>');
  return 2;
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
  check(
    node !== null && Number(node.replace(/^v/, '').split('.')[0]) >= 22,
    `Node ${node}`,
    'Нужен Node.js 22.13+',
  );
  const docker = commandVersion('docker');
  check(docker !== null, docker ?? '', 'Нет Docker: https://docs.docker.com/get-docker/');
  check(composeCommand() !== null, 'Docker Compose есть', 'Нет Docker Compose');
  check(buildxOk(), 'Docker buildx 0.17+ есть', BUILDX_HINT);
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

  const file = env();
  const users = parseUsers(file.get('AUTH_USERS'));
  check(users.length > 0, `Аккаунтов: ${users.length}`, 'Нет аккаунтов: lct user add');
  check(
    !users.some((u) => u.email === 'demo@example.com'),
    'Демо-аккаунта из примера нет',
    'Остался demo@example.com из .env.example: lct user remove demo@example.com',
  );
  check(
    Boolean(file.get('AUTH_SECRET')),
    'AUTH_SECRET задан',
    'AUTH_SECRET пуст: lct onboard его создаст',
  );

  const settings = {
    MODEL_PROVIDER: file.get('MODEL_PROVIDER') ?? '',
    LLM_BASE_URL: file.get('LLM_BASE_URL') ?? '',
    VLM_BASE_URL: file.get('VLM_BASE_URL') ?? '',
    MODEL_API_KEY: file.get('MODEL_API_KEY') ?? '',
    LLM_MODEL: file.get('LLM_MODEL') ?? '',
    VLM_MODEL: file.get('VLM_MODEL') ?? '',
  } satisfies ModelSettings;
  const spinner = p.spinner();
  spinner.start('Проверяю модель');
  const model = await checkModel(settings);
  spinner.stop(
    model.ok ? `Модель отвечает: ${model.detail}` : `Модель не отвечает: ${model.detail}`,
  );
  if (!model.ok) problems += 1;

  for (const [name, url] of [
    ['API', 'http://localhost:3001/health'],
    ['веб', 'http://localhost:3000'],
  ] as const) {
    const up = await fetch(url, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (up) p.log.success(`${name} отвечает: ${url}`);
    else p.log.info(`${name} не запущен (${url}): lct start`);
  }
  for (const port of [3000, 3001]) {
    if (!(await portFree(port)))
      p.log.info(`Порт ${port} занят (это нормально, если сервис запущен)`);
  }
  p.outro(problems === 0 ? 'Всё в порядке' : `Проблем: ${problems}`);
  return problems === 0 ? 0 : 1;
}

export const stack = {
  start: () => compose(['up', '-d']),
  stop: () => compose(['down']),
  restart: (service?: string) => compose(['restart', ...(service ? [service] : [])]),
  status: () => compose(['ps']),
  logs: (service?: string) =>
    compose(['logs', '--tail', '200', '-f', ...(service ? [service] : [])]),
};
