import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createMaintenanceCommands,
  maintenanceEnvironment,
  type MaintenanceDependencies,
  type MaintenanceProcess,
  type MaintenanceStorage,
} from './maintenance.js';

const root = resolve('fake-installation');
const directory = resolve('fake-backups', 'private');
const original = 'a'.repeat(40);
const target = 'b'.repeat(40);
const names = ['postgres', 'engine', 'api', 'web', 'search', 'proxy'];
const ids = Object.fromEntries(names.map((name, i) => [name, String(i + 1).repeat(64)]));

function fixture(initial = names) {
  const active = new Set(initial);
  const requests: MaintenanceProcess[] = [];
  const log: string[] = [];
  const files = new Map<string, string>();
  const events: string[] = [];
  let head = original;
  let cancel: () => void = () => undefined;
  const release = vi.fn(async () => {
    events.push('unlock');
  });
  const unwatch = vi.fn();
  const state = {
    fail: (_command: readonly string[]) => false,
    throw: false,
    status: '',
    upstream: target,
    mounts: [{ RW: true, Type: 'bind', Source: join(root, 'data') }],
    workingDirectory: root,
    ndjson: false,
    transitional: false,
    after: (_request: MaintenanceProcess) => undefined as void,
  };
  const storage: MaintenanceStorage = {
    prepare: vi.fn(async () => root),
    lock: vi.fn(async () => release),
    workspace: vi.fn(async () => directory),
    read: vi.fn(async () => '{"version":"0.1.0"}'),
    write: vi.fn(async (path, text) => {
      files.set(path, text);
      events.push('metadata');
    }),
    publish: vi.fn(async () => {
      events.push('publish');
    }),
    remove: vi.fn(async (path) => {
      events.push(`remove:${path}`);
    }),
  };
  const run = vi.fn(async (request: MaintenanceProcess) => {
    requests.push(request);
    const command = request.command;
    const isCompose = command[0] === 'docker' && command[1] === 'compose';
    let stdout = '';
    if (command[0] === 'tar' && command[1] === '--version') stdout = 'tar (GNU tar) 1.35';
    if (isCompose && command.includes('config')) stdout = '{"name":"lct26"}';
    if (isCompose && command.includes('stop')) {
      const service = command.at(-1) ?? '';
      active.delete(service);
      events.push(`stop:${service}`);
    }
    if (command[0] === 'docker' && command[1] === 'start') {
      const service = names.find((name) => ids[name] === command[2]) ?? '';
      active.add(service);
      events.push(`start:${service}`);
    }
    if (isCompose && command.includes('ps')) {
      const rows = names.map((name) => ({
        Service: name,
        ID: ids[name],
        State: state.transitional ? 'restarting' : active.has(name) ? 'running' : 'exited',
      }));
      stdout = state.ndjson
        ? rows.map((row) => JSON.stringify(row)).join('\n')
        : JSON.stringify(rows);
    }
    if (command[1] === 'inspect') {
      const format = command[3] ?? '';
      if (format.includes('working_dir')) stdout = state.workingDirectory;
      else if (format.includes('Mounts')) stdout = JSON.stringify(state.mounts);
      else if (format.includes('.Image')) stdout = `sha256:${'c'.repeat(64)}`;
      else if (format.includes('Running')) {
        stdout = String(names.some((name) => ids[name] === command[4] && active.has(name)));
      }
    }
    if (command[0] === 'git') {
      if (command[1] === 'status') stdout = state.status;
      if (command[1] === 'rev-parse') stdout = command.at(-1) === 'HEAD' ? head : state.upstream;
      if (command[1] === 'merge') {
        head = target;
        events.push('merge');
      }
    }
    if (request.stdoutFile) {
      files.set(request.stdoutFile, 'database fixture');
      events.push('dump');
    }
    if (command[0] === 'tar' && command.includes('--create')) events.push('tar');
    if (isCompose && command.includes('up')) events.push('up');
    state.after(request);
    if (state.fail(command)) {
      if (state.throw) throw new Error('secret-from-subprocess');
      return { code: 1, stdout: 'secret-from-subprocess' };
    }
    return { code: 0, stdout };
  });
  const deps: MaintenanceDependencies = {
    root: () => root,
    platform: 'linux',
    run,
    storage,
    log: (message) => {
      log.push(message);
    },
    healthy: vi.fn(async () => true),
    urls: () => ({ api: 'http://127.0.0.1:4201', web: 'http://127.0.0.1:4200' }),
    interrupt: vi.fn((handler) => {
      cancel = handler;
      return unwatch;
    }),
  };
  return {
    ...createMaintenanceCommands(deps),
    deps,
    state,
    requests,
    events,
    log,
    files,
    storage,
    active,
    release,
    unwatch,
    cancel: () => cancel(),
  };
}

function has(...parts: string[]) {
  return (command: readonly string[]) => parts.every((part) => command.includes(part));
}

function restored(f: ReturnType<typeof fixture>, services = ['engine', 'api', 'web']) {
  expect(f.events.filter((event) => event.startsWith('start:'))).toEqual(
    services.map((service) => `start:${service}`),
  );
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.unwatch).toHaveBeenCalledOnce();
}

describe('Docker backup orchestration', () => {
  it('freezes all writers, dumps PG and archives files before restarting original container IDs', async () => {
    const f = fixture();
    expect(await f.backupCommand()).toBe(0);
    expect(f.events.slice(0, 10)).toEqual([
      'stop:web',
      'stop:api',
      'stop:engine',
      'dump',
      'metadata',
      'tar',
      'publish',
      'start:engine',
      'start:api',
      'start:web',
    ]);
    restored(f);
    const dump = f.requests.find((request) => request.stdoutFile);
    expect(dump?.command).toEqual(expect.arrayContaining(['exec', '-T', 'postgres', 'sh', '-c']));
    expect(dump?.command.at(-1)).toContain('pg_dump --no-password');
    expect(dump?.stdoutFile).toBe(join(directory, 'database.sql'));
    expect(dump?.installationEnv).toBe(true);
    const tar = f.requests.find((request) => request.command.includes('--create'));
    expect(tar?.command).toEqual(
      expect.arrayContaining([
        '--directory',
        root,
        'data',
        'runs',
        '.env',
        directory,
        'database.sql',
        'metadata.json',
      ]),
    );
    expect(f.storage.publish).toHaveBeenCalledWith(
      join(directory, 'backup.partial.tar.gz'),
      join(directory, 'backup.tar.gz'),
    );
    const metadata = JSON.parse(f.files.get(join(directory, 'metadata.json')) ?? '') as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({ formatVersion: 1, commit: original, cliVersion: '0.1.0' });
    expect(f.log.join('\n')).toContain(join(directory, 'backup.tar.gz'));
    expect(f.requests.every((request) => request.cwd === root)).toBe(true);
    expect(
      f.requests
        .filter((request) => request.command[1] === 'compose')
        .every((request) => request.installationEnv),
    ).toBe(true);
    expect(f.requests.some((request) => request.command.includes('down'))).toBe(false);
  });

  it('keeps services stopped by the user stopped, including writer dependencies', async () => {
    const f = fixture(['postgres', 'web']);
    expect(await f.backupCommand()).toBe(0);
    restored(f, ['web']);
    expect(f.events.filter((event) => event.startsWith('stop:'))).toEqual(['stop:web']);
    expect(f.active.has('api')).toBe(false);
    expect(f.active.has('engine')).toBe(false);
  });

  it.each([
    ['partial stop', has('stop', 'api')],
    ['snapshot after stop', (command: readonly string[]) => has('ps')(command)],
    ['dump', has('exec', 'sh')],
    ['version', has('pg_dump', '--version')],
    ['archive', has('tar', '--create')],
    ['archive verification', has('tar', '--list')],
  ])('restores every original writer on %s failure', async (_name, predicate) => {
    const f = fixture();
    // The initial ps must succeed; fail ps only after a stop has occurred.
    f.state.fail = (command) =>
      predicate(command) && f.events.some((event) => event.startsWith('stop:'));
    expect(await f.backupCommand()).toBe(1);
    restored(f);
    expect(f.active.has('postgres')).toBe(true);
    expect(f.log.join('\n')).not.toContain('secret-from-subprocess');
  });

  it('also restores after a runner rejection and hides arbitrary error details', async () => {
    const f = fixture();
    f.state.fail = has('exec', 'sh');
    f.state.throw = true;
    expect(await f.backupCommand()).toBe(1);
    restored(f);
    expect(f.log.join('\n')).not.toContain('secret-from-subprocess');
  });

  it.each(['write', 'publish'] as const)(
    'restores on storage %s failure and never reports an incomplete backup',
    async (method) => {
      const f = fixture();
      vi.mocked(f.storage[method]).mockRejectedValue(new Error('secret-on-disk'));
      expect(await f.backupCommand()).toBe(1);
      restored(f);
      expect(f.log.join('\n')).not.toMatch(/Резервная копия \(содержит|secret-on-disk/);
    },
  );

  it('attempts all restarts even when the first restart fails, retaining the completed backup', async () => {
    const f = fixture();
    f.state.fail = has('docker', 'start', ids.engine ?? '');
    expect(await f.backupCommand()).toBe(1);
    restored(f);
    expect(f.log.join('\n')).toContain(`docker start ${ids.engine}`);
    expect(f.log.join('\n')).toContain(
      `Сохранённая резервная копия: ${join(directory, 'backup.tar.gz')}`,
    );
  });

  it('does not claim success when a restarted writer exits immediately', async () => {
    const f = fixture();
    f.state.after = (request) => {
      if (request.command[1] === 'start' && request.command[2] === ids.api) f.active.delete('api');
    };
    expect(await f.backupCommand()).toBe(1);
    restored(f);
  });

  it('handles interruption through finally without cancelling restoration', async () => {
    const f = fixture();
    f.state.after = (request) => {
      if (request.stdoutFile) f.cancel();
    };
    expect(await f.backupCommand()).toBe(1);
    restored(f);
    expect(f.events).not.toContain('tar');
  });

  it.each([
    'missing PostgreSQL',
    'unsupported OS',
    'transitional containers',
    'foreign project',
    'external writable mount',
    'local mode',
  ])('fails safely before stopping on %s', async (scenario) => {
    const f = fixture(scenario === 'missing PostgreSQL' ? ['api'] : names);
    if (scenario === 'unsupported OS') f.deps.platform = 'win32';
    if (scenario === 'transitional containers') f.state.transitional = true;
    if (scenario === 'foreign project') f.state.workingDirectory = '/another/installation';
    if (scenario === 'external writable mount')
      f.state.mounts = [{ RW: true, Type: 'volume', Source: 'other' }];
    if (scenario === 'local mode')
      vi.mocked(f.storage.prepare).mockRejectedValue(new Error('local mode'));
    const commands = createMaintenanceCommands(f.deps);
    expect(await commands.backupCommand()).toBe(1);
    expect(f.events.some((event) => event.startsWith('stop:'))).toBe(false);
    expect(f.storage.workspace).not.toHaveBeenCalled();
  });

  it('accepts Compose NDJSON and does not stop postgres, search or proxy', async () => {
    const f = fixture();
    f.state.ndjson = true;
    expect(await f.backupCommand()).toBe(0);
    expect(f.events.filter((event) => event.startsWith('stop:'))).toEqual([
      'stop:web',
      'stop:api',
      'stop:engine',
    ]);
  });

  it('refuses a workspace inside the installation before stopping writers', async () => {
    const f = fixture();
    vi.mocked(f.storage.workspace).mockResolvedValue(join(root, 'backups'));
    expect(await f.backupCommand()).toBe(1);
    expect(f.events.some((event) => event.startsWith('stop:'))).toBe(false);
  });
});

describe('maintenance process environment', () => {
  it('uses installation secrets and profiles while preserving the installed runtime', () => {
    const values: Record<string, string> = {
      POSTGRES_PASSWORD: 'private-value',
      COMPOSE_PROFILES: 'https,search',
      WEB_SEARCH_URL: '',
    };
    const shell = {
      POSTGRES_PASSWORD: 'wrong-export',
      COMPOSE_PROFILES: 'wrong-profile',
      WEB_SEARCH_URL: 'wrong',
      PATH: '/installed/node/bin:/usr/bin',
      NODE_OPTIONS: '--max-old-space-size=4096',
      TAR_OPTIONS: '--dereference',
      GZIP: '--verbose',
    };
    const env = maintenanceEnvironment(shell, {
      text: () =>
        Object.keys(values)
          .map((key) => `${key}=value`)
          .join('\n'),
      get: (key) => values[key],
    });
    expect(env).toMatchObject({ ...values, PATH: shell.PATH, NODE_OPTIONS: shell.NODE_OPTIONS });
    expect(env.TAR_OPTIONS).toBeUndefined();
    expect(env.GZIP).toBeUndefined();
    expect(shell.POSTGRES_PASSWORD).toBe('wrong-export');
  });
});

describe('manual update orchestration', () => {
  it('fetches, checks ancestry, backs up, fast-forwards and builds only originally running services', async () => {
    const f = fixture(['postgres', 'api', 'web']);
    expect(await f.updateCommand()).toBe(0);
    const commands = f.requests.map((request) => request.command);
    const index = (part: string) => commands.findIndex((command) => command.includes(part));
    expect(index('fetch')).toBeLessThan(index('merge-base'));
    expect(f.events.indexOf('publish')).toBeLessThan(f.events.indexOf('merge'));
    expect(f.events.indexOf('merge')).toBeLessThan(f.events.indexOf('up'));
    expect(commands).toContainEqual(['git', 'merge', '--ff-only', '--no-overwrite-ignore', target]);
    expect(commands).toContainEqual(['corepack', 'yarn', 'install', '--immutable']);
    expect(commands).toContainEqual(['corepack', 'yarn', 'nx', 'run', 'cli:build']);
    const up = commands.find((command) => command.includes('up')) ?? [];
    expect(up.slice(up.indexOf('up'))).toEqual([
      'up',
      '-d',
      '--build',
      '--no-deps',
      '--wait',
      '--wait-timeout',
      '180',
      'postgres',
      'api',
      'web',
    ]);
    expect(up).not.toContain('engine');
    expect(up).not.toContain('search');
    expect(f.deps.healthy).toHaveBeenCalledWith('http://127.0.0.1:4201/health');
    expect(f.deps.healthy).toHaveBeenCalledWith('http://127.0.0.1:4200');
    expect(f.active.has('engine')).toBe(false);
    restored(f, ['api', 'web']);
  });

  it.each([' M tracked.ts\0', '?? untracked.txt\0'])(
    'requires clean tracked and untracked files (%j)',
    async (status) => {
      const f = fixture();
      f.state.status = status;
      expect(await f.updateCommand()).toBe(1);
      expect(f.storage.workspace).not.toHaveBeenCalled();
      expect(f.requests.some((request) => request.command.includes('fetch'))).toBe(false);
    },
  );

  it.each([
    ['divergence', has('merge-base')],
    ['missing upstream', has('@{upstream}')],
    ['detached checkout', has('symbolic-ref')],
    ['fetch failure', has('fetch')],
    ['missing installed Corepack', has('corepack', '--version')],
  ])('rejects %s before backup or changes to checkout', async (_name, predicate) => {
    const f = fixture();
    f.state.fail = predicate;
    expect(await f.updateCommand()).toBe(1);
    expect(f.storage.workspace).not.toHaveBeenCalled();
    expect(f.events).not.toContain('merge');
  });

  it('does nothing when upstream is already installed', async () => {
    const f = fixture();
    f.state.upstream = original;
    expect(await f.updateCommand()).toBe(0);
    expect(f.storage.workspace).not.toHaveBeenCalled();
    expect(f.events).not.toContain('merge');
  });

  it('does not update after backup failure', async () => {
    const f = fixture();
    f.state.fail = has('tar', '--create');
    expect(await f.updateCommand()).toBe(1);
    expect(f.events).not.toContain('merge');
    restored(f);
  });

  it.each([
    ['fast-forward', has('git', 'merge')],
    ['immutable install', has('yarn', 'install')],
    ['CLI build', has('cli:build')],
    ['Compose build/health', has('up')],
  ])('retains backup and prints honest recovery on %s failure', async (_name, predicate) => {
    const f = fixture();
    f.state.fail = predicate;
    expect(await f.updateCommand()).toBe(1);
    const output = f.log.join('\n');
    expect(output).toContain(join(directory, 'backup.tar.gz'));
    expect(output).toContain('Автоматического отката нет');
    expect(output).toContain(`git switch --detach ${original}`);
    expect(output).toContain('corepack yarn install --immutable');
    expect(output).toContain('tar -xzf');
    expect(output).not.toContain('secret-from-subprocess');
    expect(f.requests.some((request) => request.command.includes('reset'))).toBe(false);
    restored(f);
  });

  it('reports failed HTTP health checks using configured ports', async () => {
    const f = fixture();
    vi.mocked(f.deps.healthy).mockResolvedValue(false);
    expect(await f.updateCommand()).toBe(1);
    expect(f.log.join('\n')).toContain('проверка доступности api');
    expect(f.log.join('\n')).toContain('Автоматического отката нет');
  });

  it('does not check HTTP endpoints of services stopped by the user', async () => {
    const f = fixture(['postgres', 'engine']);
    expect(await f.updateCommand()).toBe(0);
    expect(f.deps.healthy).not.toHaveBeenCalled();
  });

  it('rejects concurrent edits and service state changes after backup', async () => {
    const f = fixture();
    f.state.after = (request) => {
      if (request.command[1] === 'start') f.state.status = '?? new-file\0';
    };
    expect(await f.updateCommand()).toBe(1);
    expect(f.events).not.toContain('merge');
    expect(f.log.join('\n')).toContain('Сохранённая резервная копия');
  });
});
