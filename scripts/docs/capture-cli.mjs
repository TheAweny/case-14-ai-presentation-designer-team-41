// Captures the real CLI renderers against an isolated installation and offline adapters.
import { registerHooks } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

const [scene, destination] = process.argv.slice(2);
const scenes = ['menu', 'users', 'model', 'settings', 'summary', 'progress', 'bootstrap'];
if (!scenes.includes(scene) || !destination)
  throw new Error('Usage: capture-cli.mjs SCENE OUTPUT.ansi');
const root = resolve(import.meta.dirname, '../..');
const sandbox = mkdtempSync(join(tmpdir(), 'lct-docs-'));
const target = resolve(destination);
mkdirSync(resolve(target, '..'), { recursive: true });
process.env.LCT_HOME = sandbox;
process.env.TERM = 'xterm-256color';
process.env.COLORTERM = 'truecolor';
process.env.LCT_REDUCED_MOTION = '1';
delete process.env.NO_COLOR;
delete process.env.FORCE_COLOR;
delete process.env.LCT_ADMIN_PASSWORD;
delete process.env.LCT_ADMIN_EMAIL;
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.API_SERVICE_TOKEN = 'documentation-only-service-token';
delete process.env.LCT_INSTALL_ADMIN_PASSWORD;
writeFileSync(
  join(sandbox, '.env'),
  [
    'LCT_MODE=docker',
    'LLM_MODEL=demo-model',
    'MODEL_PROVIDER=',
    'ADMIN_EMAIL=admin@example.com',
    'ADMIN_NAME=Administrator',
    'ADMIN_PASSWORD=demonstration-only',
    'APP_ORIGIN=https://slides.example.com',
    'LCT_DOMAIN=slides.example.com',
    'WEB_PORT=3000',
    'API_HOST_PORT=3001',
    'POSTGRES_PORT=5433',
    'API_DOCS_ENABLED=false',
    'WEB_SEARCH_URL=',
    'COMPOSE_PROFILES=https',
    'WEB_BIND=127.0.0.1',
    ...[
      'AUTH_SECRET',
      'API_SERVICE_TOKEN',
      'MODEL_KEYS_SECRET',
      'SEARXNG_SECRET',
      'POSTGRES_PASSWORD',
    ].map((key) => `${key}=documentation-only-secret-not-for-service`),
  ].join('\n'),
);

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/apps/cli/dist/setup/')) {
      let source;
      if (specifier === './stack.js')
        source = `
        export const repoRoot = () => process.env.LCT_HOME;
        export const runningServices = () => ['postgres','engine','api','web','proxy'];
        export const composeCommand = () => ['docker','compose'];
        export const buildxOk = () => true;
        export const BUILDX_HINT = '';
        export const databaseVolumeExists = () => true;
        export const portFree = async () => true;
        export const compose = async () => 0;
        export const run = async () => 0;
        export const waitFor = async () => true;
        export const commandVersion = () => 'v24.19.0';
        export const nodeVersionOk = () => true;`;
      if (specifier === './account-client.js')
        source = `
        export class AccountClientError extends Error {}
        export class AccountClient {
          async withAdminSession(_credentials, callback) {
            return callback({ list: async () => [] });
          }
        }`;
      if (source)
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

let transcript = '';
const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
const output = Object.assign(
  new Writable({
    write(chunk, _encoding, next) {
      transcript += chunk.toString();
      next();
    },
  }),
  { isTTY: true, columns: 96, rows: 32, getColorDepth: () => 24 },
);
Object.defineProperty(process, 'stdin', { value: input });
Object.defineProperty(process, 'stdout', { value: output });
Object.defineProperty(process, 'stderr', { value: output });
const pause = () => new Promise((done) => setTimeout(done, 30));
const until = async (text) => {
  for (let i = 0; i < 100; i++) {
    if (stripVTControlCharacters(transcript).includes(text)) {
      await pause();
      return;
    }
    await pause();
  }
  writeFileSync(target, transcript);
  throw new Error(`Prompt did not appear: ${text}`);
};
const send = async (text) => {
  input.write(text);
  await pause();
};
const load = (file) => import(pathToFileURL(join(root, 'apps/cli/dist/setup', file)).href);
try {
  if (scene === 'menu') {
    const { menu } = await load('menu.js');
    void menu().catch(() => {});
    await until('Управление сервисом');
  } else if (scene === 'users') {
    const { usersMenu } = await load('user-command.js');
    void usersMenu().catch(() => {});
    await until('Актуальная почта');
    await send('\r');
    await until('Актуальный пароль');
    await send('demonstration-only\r');
    await until('Список аккаунтов');
  } else if (scene === 'model') {
    const { onboard } = await load('onboard.js');
    void onboard({ section: 'model' }).catch(() => {});
    await until('Откуда брать модель?');
  } else if (scene === 'settings' || scene === 'summary') {
    const { onboard } = await load('onboard.js');
    void onboard({ section: 'settings' }).catch(() => {});
    await until('Как открывать приложение?');
    await send('\r');
    await until('Домен приложения');
    await send('\r');
    await until('Включить документацию API?');
    if (scene === 'summary') {
      await send('\r');
      await until('Включить поиск в интернете?');
      await send('\r');
      await until('Сохранить настройки?');
      // The temporary physical path is the only machine-specific part of this frame.
      transcript = transcript.replaceAll(sandbox, '/opt/lct26'.padEnd(sandbox.length));
    }
  } else if (scene === 'progress') {
    const { progress } = await load('progress.js');
    const indicator = progress({ output, env: process.env });
    indicator.start('Собираю и запускаю сервисы');
    await pause();
  } else {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
    const result = spawnSync(
      bash,
      [
        '-c',
        `source install.sh
RICH=1; COLOR_MODE=24; RESET=$'\\033[0m'; COLUMNS=96; UI_OUT=1
show_banner
STEP='4/6 · Node и Corepack'
render_frame 64 node-runtime.tar.xz 0`,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: process.env,
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    transcript = result.stdout;
  }
  writeFileSync(target, transcript);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
process.exit(0);
