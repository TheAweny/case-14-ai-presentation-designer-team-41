import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const installer = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'install.sh');
// Git Bash runs these fixtures on Windows. No WSL, apt or Docker is started.
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const scratch: string[] = [];
const posix = (path: string) =>
  path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lct-bootstrap-test-'));
  scratch.push(dir);
  const home = join(dir, 'home');
  const repo = join(home, "checkout with spaces 'quote'");
  const bin = join(dir, 'fake-bin');
  const logs = join(dir, 'logs');
  for (const path of [home, repo, bin, logs, join(repo, 'apps/cli/src'), join(repo, 'packages')]) {
    mkdirSync(path, { recursive: true });
  }
  for (const path of ['package.json', 'yarn.lock', 'nx.json', 'apps/cli/src/main.ts']) {
    writeFileSync(join(repo, path), path === 'package.json' ? '{"name":"lct26"}' : 'fixture\n');
  }
  writeFileSync(join(repo, 'local-changes.txt'), 'keep me\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: posix(home),
    TMPDIR: posix(logs),
    XDG_DATA_HOME: posix(join(home, '.local/share')),
    LCT_HOME: posix(repo),
    BOOTSTRAP_SCRIPT: posix(installer),
    FIXTURE: posix(dir),
    FAKE_BIN: posix(bin),
    TRACE: posix(join(dir, 'trace')),
    REAL_NODE: posix(process.execPath),
    FAKE_CONSUME_STDIN: '0',
    NO_COLOR: '',
    TERM: 'xterm',
    MSYS_NO_PATHCONV: '1',
    MSYS2_ARG_CONV_EXCL: '*',
  };
  const script = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/bin/bash\nset -eu\nprintf '%s' '${name}' >>"$TRACE"\nprintf ' <%s>' "$@" >>"$TRACE"\nprintf '\\n' >>"$TRACE"\n${body}\n`,
    );
    chmodSync(path, 0o755);
  };
  writeFileSync(
    join(dir, 'node-version.cjs'),
    "Object.defineProperty(process.versions, 'node', { value: process.env.FAKE_NODE_VERSION || '22.13.0' });\n",
  );
  script(
    'node',
    `
if [[ $0 == */v22.23.3/bin/node ]]; then export FAKE_NODE_VERSION=22.23.3; fi
if [[ \${1:-} == -e ]]; then
  preload="$FIXTURE/node-version.cjs"
  if command -v cygpath >/dev/null; then preload=$(cygpath -m "$preload"); fi
  exec "$REAL_NODE" --require "$preload" "$@"
elif [[ \${1:-} == --version ]]; then echo v22.13.0
else
  printf '%s\\0' "$@" >"$FIXTURE/onboard-args"
  printf '%s' "$LCT_HOME" >"$FIXTURE/onboard-home"
  echo 'wizard output stays visible'
  exit "\${FAKE_ONBOARD_EXIT:-0}"
fi`,
  );
  script(
    'corepack',
    `
if [[ $FAKE_CONSUME_STDIN == 1 ]]; then cat >/dev/null; fi
if [[ \${1:-} == --version ]]; then echo 0.34.0; exit 0; fi
echo 'private dependency output'
if [[ \${1:-} == yarn && \${2:-} == install ]]; then exit "\${FAKE_INSTALL_EXIT:-0}"; fi
if [[ \${1:-} == yarn && \${2:-} == nx ]]; then
  mkdir -p "$LCT_HOME/apps/cli/dist"
  echo built >"$LCT_HOME/apps/cli/dist/main.js"
fi`,
  );
  script(
    'git',
    `
if [[ \${1:-} == -C ]]; then printf '%s\\n' "$2"
elif [[ \${1:-} == clone ]]; then
  dest=\${!#}; mkdir -p "$dest"
  cp -R "$FIXTURE/home/checkout with spaces 'quote'/." "$dest/"
  exit "\${FAKE_CLONE_EXIT:-0}"
else exit 91
fi`,
  );
  script(
    'docker',
    `
case "\${1:-}" in
  compose) [[ ! -f $FIXTURE/docker-missing ]] || exit 1; echo 'Docker Compose version v2.40.0' ;;
  buildx) echo "github.com/docker/buildx \${FAKE_BUILDX_VERSION:-v0.17.0} abc" ;;
  info) [[ \${FAKE_DOCKER_DENIED:-0} == 0 || \${ELEVATED:-0} == 1 ]] ;;
esac`,
  );
  script(
    'sudo',
    `
[[ \${FAKE_SUDO_FAIL:-0} == 0 ]] || exit 1
if [[ \${1:-} == -v || \${2:-} == -v ]]; then exit 0; fi
[[ \${1:-} != -n ]] || shift
[[ \${1:-} != -- ]] || shift
export ELEVATED=1
exec "$@"`,
  );
  script('apt-get', 'case " $* " in *" docker-ce "*) rm -f "$FIXTURE/docker-missing" ;; esac');
  script('dpkg-query', 'exit 1');
  script('dpkg', 'echo amd64');
  script('uname', 'case $1 in -m) echo x86_64 ;; -s) echo Linux ;; esac');
  script(
    'curl',
    `
printf '%s\\n' "$BASHPID" >"$FIXTURE/curl.pid"
if [[ -n \${FAKE_CURL_STREAM:-} ]]; then
  cat "$FAKE_CURL_STREAM" >&2
  exit "\${FAKE_CURL_EXIT:-0}"
fi
url=$1
while (( $# )); do
  case $1 in https://*) url=$1 ;; --output) shift; out=$1 ;; esac
  shift
done
case $url in
  */gpg) echo 'fixture key' >"$out" ;;
  */SHASUMS256.txt) cp "$FIXTURE/SHASUMS256.txt" "$out" ;;
  *.tar.xz) cp "$FIXTURE/node.tar.xz" "$out"; [[ \${FAKE_BAD_HASH:-0} == 0 ]] || echo corrupt >>"$out" ;;
  *) exit 92 ;;
esac`,
  );
  script(
    'install',
    `
# Never writes /etc: capture repository config inside the fixture.
if [[ \${!#} == /etc/apt/sources.list.d/docker.sources ]]; then cp "$3" "$FIXTURE/docker.sources"; fi`,
  );
  const run = (code: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(
      bash,
      ['-c', `export PATH="$FAKE_BIN:$PATH"\n${code}`, 'bootstrap-test', ...args],
      {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    if (result.error) throw result.error;
    return result;
  };
  const source = 'source "$BOOTSTRAP_SCRIPT"\n';
  const main = `${source}
# Override platform/identity only; real steps, validation and ERR traps execute.
# Fake non-root identity routes all system commands through the fake sudo.
check_platform() { CODENAME=noble; }
is_root() { return 1; }
main "$@"`;
  const trace = () =>
    existsSync(join(dir, 'trace')) ? readFileSync(join(dir, 'trace'), 'utf8') : '';
  const log = () =>
    readdirSync(logs)
      .filter((name) => name.startsWith('lct-bootstrap.'))
      .map((name) => readFileSync(join(logs, name, 'install.log'), 'utf8'))
      .join('\n');
  const onboardArgs = () =>
    readFileSync(join(dir, 'onboard-args'), 'utf8').split('\0').slice(0, -1);
  return { dir, repo, home, logs, run, source, main, trace, log, onboardArgs, script };
}

describe('Ubuntu bootstrap (offline Bash with fake commands)', { timeout: 30_000 }, () => {
  it.each([20, 26, 40, 58, 80])('fits the ASCII banner into %s columns', (width) => {
    const f = fixture();
    const result = f.run(`${f.source}\nbanner_art ${width}`);
    expect(result.status).toBe(0);
    const lines = result.stdout.trimEnd().split(/\r?\n/);
    expect(lines.every((line) => line.length <= width)).toBe(true);
    expect(result.stdout).not.toContain('\u001b');
    if (width >= 58) expect(result.stdout).toContain('.-------------------.');
    else if (width >= 26) expect(result.stdout).toContain('/_____/\\____/ /_/');
    else expect(result.stdout).toContain('[ LCT 26 ]');
    expect(f.trace()).toBe('');
  });

  it('keeps redirected installation output compact', () => {
    const f = fixture();
    const result = f.run(`${f.source}\nACCENT= RESET=; show_banner`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('LCT26 · Дизайнер презентаций');
    expect(result.stdout).not.toContain('/_____/');
    expect(result.stdout).not.toContain('\u001b');
  });

  it('has valid Bash syntax and --help has no commands or writes', () => {
    const f = fixture();
    expect(f.run('bash -n "$BOOTSTRAP_SCRIPT"').status).toBe(0);
    const result = f.run('bash "$BOOTSTRAP_SCRIPT" --help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('LCT_HOME');
    expect(f.trace()).toBe('');
    expect(readdirSync(f.logs)).toEqual([]);
    expect(existsSync(join(f.home, '.local'))).toBe(false);
  });

  it('keeps dirty checkouts, forwards secret/spaced arguments and repeats safely', () => {
    const f = fixture();
    const args = [
      '--yes',
      '--no-start',
      '--api-key',
      'secret $(must not execute)',
      '--admin-name',
      'Анна Иванова',
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.run(f.main, args);
      expect(result.status, result.stdout + result.stderr + f.log()).toBe(0);
      expect(result.stdout).toContain('wizard output stays visible');
      expect(result.stdout).not.toContain('private dependency output');
      expect(result.stdout).not.toContain('\u001b');
      expect(f.onboardArgs()).toEqual([
        `${posix(f.repo)}/apps/cli/dist/main.js`,
        'onboard',
        ...args,
      ]);
    }
    expect(readFileSync(join(f.repo, 'local-changes.txt'), 'utf8')).toBe('keep me\n');
    expect(f.trace()).not.toMatch(/git <(?:pull|fetch|reset|clean|clone)>/);
    expect(f.trace()).toContain('corepack <yarn> <install> <--immutable>');
    expect(f.trace()).toContain('corepack <yarn> <nx> <run> <cli:build>');
    expect(f.log()).toContain('private dependency output');
    expect(f.log()).not.toContain(args[3]);
    expect(f.log()).not.toContain('wizard output stays visible');
    expect(readFileSync(join(f.dir, 'onboard-home'), 'utf8')).toBe(posix(f.repo));
  });

  it('retains private logs and propagates nested failures without onboarding', () => {
    const f = fixture();
    const result = f.run(f.main, ['--yes', '--api-key', 'do-not-log-me'], {
      FAKE_INSTALL_EXIT: '42',
    });
    expect(result.status).toBe(42);
    expect(result.stderr).toContain('5/6');
    expect(result.stderr).toContain('install.log');
    expect(f.log()).toContain('status=42');
    expect(f.log()).not.toContain('do-not-log-me');
    expect(existsSync(join(f.dir, 'onboard-args'))).toBe(false);
    expect(existsSync(join(f.home, '.local/bin/lct'))).toBe(false);
    const entry = readdirSync(f.logs)[0] ?? '';
    expect(entry).not.toBe('');
    expect(readdirSync(join(f.logs, entry))).toEqual(['install.log']);
    if (process.platform !== 'win32') {
      expect(statSync(join(f.logs, entry, 'install.log')).mode & 0o777).toBe(0o600);
      expect(statSync(join(f.logs, entry)).mode & 0o777).toBe(0o700);
    }
  });

  it('propagates onboard failures without recording its output or arguments', () => {
    const f = fixture();
    const result = f.run(f.main, ['--yes', '--admin-password', 'secret'], {
      FAKE_ONBOARD_EXIT: '17',
    });
    expect(result.status).toBe(17);
    expect(result.stderr).toContain('onboard');
    expect(f.log()).not.toContain('secret');
    expect(f.log()).not.toContain('wizard output');
  });

  it('does not silently opt into unattended mode with piped stdin', () => {
    const f = fixture();
    const result = f.run(f.main);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--yes');
    expect(f.trace()).toBe('');
    expect(readdirSync(f.logs)).toEqual([]);
  });

  it('never overwrites an unrelated lct executable', () => {
    const f = fixture();
    const target = join(f.home, '.local/bin/lct');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'another application\n');
    const result = f.run(f.main, ['--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('уже существует');
    expect(readFileSync(target, 'utf8')).toBe('another application\n');
  });

  it('rejects foreign ownership before sudo or build', () => {
    const f = fixture();
    const result = f.run(`${f.source}
check_platform() { CODENAME=noble; }
is_root() { return 1; }
stat() { echo foreign-owner; }
main --yes`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('принадлежит другому');
    expect(f.trace()).toBe('');
  });

  it('installs Docker from the signed official APT repository when Compose is missing', () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'docker-missing'), '');
    const result = f.run(f.main, ['--yes']);
    expect(result.status, result.stderr + f.log()).toBe(0);
    expect(f.trace()).toContain(
      '<docker-ce> <docker-ce-cli> <containerd.io> <docker-buildx-plugin> <docker-compose-plugin>',
    );
    expect(readFileSync(join(f.dir, 'docker.sources'), 'utf8')).toContain(
      'Signed-By: /etc/apt/keyrings/docker.asc',
    );
    expect(readFileSync(join(f.dir, 'docker.sources'), 'utf8')).toContain('Suites: noble');
    expect(f.trace()).not.toContain('<remove>');
  });

  it('provides a private sudo shim when Docker is inaccessible to the caller', () => {
    const f = fixture();
    const result = f.run(f.main, ['--yes'], { FAKE_DOCKER_DENIED: '1' });
    expect(result.status, result.stderr + f.log()).toBe(0);
    const shim = join(f.home, '.local/share/lct26/runtime/docker-bin/docker');
    expect(readFileSync(shim, 'utf8')).toContain('exec sudo -n --');
    expect(
      f.run('"$HOME/.local/share/lct26/runtime/docker-bin/docker" info', [], {
        FAKE_DOCKER_DENIED: '1',
      }).status,
    ).toBe(0);
    expect(f.trace()).not.toContain('usermod');
  });

  it('runs the Docker shim without inherited input when sudo is already authenticated', () => {
    const f = fixture();
    const result = f.run(
      `${f.source}
STATE="$FIXTURE/runtime"; DOCKER_BIN=$(command -v docker)
write_docker_shim
"$STATE/docker-bin/docker" info </dev/null >"$FIXTURE/docker.log" 2>&1`,
      [],
      {
        FAKE_DOCKER_DENIED: '1',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(f.trace()).toContain('sudo <-n> <-v>');
    expect(f.trace()).toMatch(/sudo <-n> <--> <[^>]*docker> <info>/);
    expect(readFileSync(join(f.dir, 'docker.log'), 'utf8')).toBe('');
  });

  it('fails with an actionable hint and never runs Docker when sudo renewal fails', () => {
    const f = fixture();
    const result = f.run(
      `${f.source}
STATE="$FIXTURE/runtime"; DOCKER_BIN=$(command -v docker)
write_docker_shim
"$STATE/docker-bin/docker" info </dev/null >"$FIXTURE/docker.log" 2>&1`,
      [],
      {
        FAKE_SUDO_FAIL: '1',
      },
    );
    expect(result.status).toBe(1);
    expect(readFileSync(join(f.dir, 'docker.log'), 'utf8')).toContain('sudo -v');
    expect(f.trace()).not.toContain('docker <info>');
    expect(f.trace()).not.toContain('sudo <-n> <--> ');
  });

  it.skipIf(process.platform === 'win32')(
    'renews expired sudo on the controlling terminal while Compose streams are captured',
    () => {
      const f = fixture();
      f.script(
        'sudo',
        `
if [[ \${1:-} == -n && \${2:-} == -v ]]; then
  if [[ -f "$FIXTURE/sudo-ticket" ]]; then exit 0; else exit 1; fi
fi
if [[ \${1:-} == -v ]]; then
  [[ -t 0 && -t 1 && -t 2 ]] || exit 31
  printf 'terminal-only authentication\\n'
  touch "$FIXTURE/sudo-ticket"
  exit 0
fi
[[ \${1:-} == -n && \${2:-} == -- && -f "$FIXTURE/sudo-ticket" ]] || exit 32
shift 2
export ELEVATED=1
exec "$@"`,
      );
      f.script(
        'retry-docker',
        `
exec "$FIXTURE/runtime/docker-bin/docker" info </dev/null >"$FIXTURE/docker.log" 2>&1`,
      );
      const result = f.run(
        `${f.source}
STATE="$FIXTURE/runtime"; DOCKER_BIN=$(command -v docker)
write_docker_shim
script -q -e -c retry-docker /dev/null`,
        [],
        {
          FAKE_DOCKER_DENIED: '1',
          SHELL: '/bin/bash',
        },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain('terminal-only authentication');
      expect(readFileSync(join(f.dir, 'docker.log'), 'utf8')).toBe('');
      expect(f.trace()).toContain('docker <info>');
      expect(existsSync(join(f.dir, 'sudo-ticket'))).toBe(true);
    },
  );

  it.each(['22.12.9', '22.13.0', '22.99.0', '24.0.0'])(
    'checks the minor Node version: %s',
    (version) => {
      const f = fixture();
      expect(f.run(`${f.source}\nnode_ok`, [], { FAKE_NODE_VERSION: version }).status).toBe(
        version === '22.12.9' ? 1 : 0,
      );
    },
  );

  it('leaves no target or staging checkout after a failed clone', () => {
    const f = fixture();
    const target = join(f.home, 'new-clone');
    const result = f.run(f.main, ['--yes'], { LCT_HOME: posix(target), FAKE_CLONE_EXIT: '23' });
    expect(result.status).toBe(23);
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(f.home).some((name) => name.startsWith('.lct-clone'))).toBe(false);
  });

  it('preserves an existing unrelated directory', () => {
    const f = fixture();
    const target = join(f.home, 'unrelated');
    mkdirSync(target);
    writeFileSync(join(target, 'data'), 'precious');
    expect(f.run(f.main, ['--yes'], { LCT_HOME: posix(target) }).status).toBe(1);
    expect(readdirSync(target)).toEqual(['data']);
    expect(f.trace()).toBe('');
  });

  it('fits narrow progress and rejects shell arithmetic in COLUMNS', () => {
    const f = fixture();
    const result = f.run(`${f.source}\nCOLUMNS=20 status_line 'a very long progress step title'`);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(17);
    expect(result.stdout).toMatch(/\.\.\.$/);
    expect(f.run(`${f.source}\nCOLUMNS=020 status_line hello`).stdout).toBe('hello');
    const step = f.run(`${f.source}
LOG="$FIXTURE/step.log"; RICH=0; ACCENT=; RESET=; COLUMNS=20
run_step 'a very long progress step title' printf 'hidden output'`);
    expect(step.status).toBe(0);
    expect(
      step.stdout
        .trimEnd()
        .split('\n')
        .every((line) => line.length <= 20),
    ).toBe(true);
    expect(step.stdout).not.toContain('hidden output');
    expect(f.run(`${f.source}\nCOLUMNS='x[$(exit 90)]' status_line hello`).stdout).toBe('hello');
  });

  it('rejects tampered Node archives before extraction or execution', () => {
    const f = fixture();
    writeFileSync(join(f.dir, 'node.tar.xz'), 'fake download');
    const digest = f.run('sha256sum "$FIXTURE/node.tar.xz"').stdout.split(' ')[0] ?? '';
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(f.dir, 'SHASUMS256.txt'), `${digest}  node-v22.23.3-linux-x64.tar.xz\n`);
    const result = f.run(
      `${f.source}
RED= RESET= ACCENT= STEP=node SPINNER_PID= CLONE_STAGE=
WORK="$FIXTURE/work"; STATE="$FIXTURE/runtime"; LOG="$FIXTURE/hash.log"
mkdir "$WORK" "$STATE"
trap cleanup EXIT
trap 'on_error "$?" "$LINENO"' ERR
uname() { echo x86_64; }
install_node`,
      [],
      { FAKE_NODE_VERSION: '22.12.0', FAKE_BAD_HASH: '1' },
    );
    expect(result.status).toBe(1);
    expect(existsSync(join(f.dir, 'runtime/v22.23.3'))).toBe(false);
    expect(readFileSync(join(f.dir, 'hash.log'), 'utf8')).toContain('status=1');
    expect(existsSync(join(f.dir, 'work'))).toBe(false);
  });

  it('downloads, verifies and reuses the official Node runtime without a package manager', () => {
    const f = fixture();
    const archive = f.run(`mkdir -p "$FIXTURE/node-tree/package/bin"
cp "$FAKE_BIN/node" "$FAKE_BIN/corepack" "$FIXTURE/node-tree/package/bin/"
tar -cJf "$FIXTURE/node.tar.xz" -C "$FIXTURE/node-tree" package
sha256sum "$FIXTURE/node.tar.xz"`);
    expect(archive.status, archive.stderr).toBe(0);
    const digest = archive.stdout.split(' ')[0] ?? '';
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(f.dir, 'SHASUMS256.txt'), `${digest}  node-v22.23.3-linux-x64.tar.xz\n`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.run(f.main, ['--yes'], { FAKE_NODE_VERSION: '22.12.0' });
      expect(result.status, result.stderr + f.log()).toBe(0);
    }
    expect(
      f.trace().match(/<https:\/\/nodejs.org\/download\/release\/v22.23.3\/SHASUMS256.txt>/g),
    ).toHaveLength(1);
    expect(existsSync(join(f.home, '.local/share/lct26/runtime/v22.23.3/bin/node'))).toBe(true);
    expect(f.trace()).not.toMatch(/^(npm|pnpm) /m);
  });

  it.each([['--mode', 'local'], ['--mode=local']])(
    'skips Docker for explicit local mode %j',
    (...modeArgs) => {
      const f = fixture();
      writeFileSync(join(f.dir, 'docker-missing'), '');
      const result = f.run(f.main, ['--yes', ...modeArgs]);
      expect(result.status, result.stderr + f.log()).toBe(0);
      expect(f.trace()).not.toContain('docker <');
      expect(f.trace()).not.toContain('<docker-ce>');
      expect(f.onboardArgs()).toEqual([
        `${posix(f.repo)}/apps/cli/dist/main.js`,
        'onboard',
        '--yes',
        ...modeArgs,
      ]);
    },
  );

  it('cannot let dependency installers consume the remaining piped script', () => {
    const f = fixture();
    const result = f.run('printf "%s\\n" "$PIPE_HARNESS" | bash -s -- "$@"', ['--yes'], {
      PIPE_HARNESS: `${f.main}\nprintf 'script-tail survived\\n'\n`,
      FAKE_CONSUME_STDIN: '1',
    });
    expect(result.status, result.stderr + f.log()).toBe(0);
    expect(result.stdout).toContain('script-tail survived');
    expect(f.onboardArgs()[1]).toBe('onboard');
  });

  it('clones the configured repository once and preserves it on subsequent runs', () => {
    const f = fixture();
    const target = join(f.home, 'new-clone');
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.run(f.main, ['--yes'], {
        LCT_HOME: posix(target),
        LCT_REPO: 'https://mirror.example/team.git',
      });
      expect(result.status, result.stderr + f.log()).toBe(0);
    }
    expect(f.trace().match(/git <clone>/g)).toHaveLength(1);
    expect(f.trace()).toContain('<https://mirror.example/team.git>');
    expect(readFileSync(join(target, 'local-changes.txt'), 'utf8')).toBe('keep me\n');
  });

  it('chooses root and local-clone paths without mutating either system directory', () => {
    const f = fixture();
    const root = f.run(`${f.source}
unset LCT_HOME LCT_REPO
is_root() { return 0; }
configure_paths ''
printf '%s\\n' "$ROOT" "$BIN_DIR" "$REPO"`);
    expect(root.status).toBe(0);
    expect(root.stdout.split('\n')).toEqual([
      '/opt/lct26',
      '/usr/local/bin',
      'https://github.com/TheAweny/case-14-ai-presentation-designer-team-41.git',
      '',
    ]);
    const local = f.run(`${f.source}
checkout=$LCT_HOME
unset LCT_HOME
is_root() { return 1; }
configure_paths "$checkout"
printf '%s\\n' "$ROOT" "$BIN_DIR"`);
    expect(local.status).toBe(0);
    expect(local.stdout.split('\n')).toEqual([posix(f.repo), `${posix(f.home)}/.local/bin`, '']);
    expect(f.trace()).toBe('');
  });

  it('refreshes an expired sudo session outside the redirected installation log', () => {
    const f = fixture();
    const result = f.run(`${f.source}
UI_OUT=3 UI_ERR=4
exec 3>&1 4>&2
is_root() { return 1; }
sudo() {
  if [[ $1 == -n && $2 == -v ]]; then return 1; fi
  shift 2
  "$@"
}
prepare_sudo() { printf 'terminal-only authentication\\n'; }
system printf 'system command output\\n' >"$FIXTURE/system.log" 2>&1`);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('terminal-only authentication\n');
    expect(readFileSync(join(f.dir, 'system.log'), 'utf8')).toBe('system command output\n');
  });
});

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const plain = (text: string) => text.replace(ansiPattern, '').replaceAll('\r', '');

// Observe real atomic snapshots while preserving the production writer/renderer.
const downloadSetup = `
WORK="$FIXTURE/work"; LOG="$FIXTURE/download.log"; STEP=download
RED= RESET= ACCENT= RICH=0
mkdir -p "$WORK"
exec 3>&1 4>&2
UI_OUT=3 UI_ERR=4
trap cleanup EXIT
trap 'on_error "$?" "$LINENO"' ERR
trap 'exit 130' INT
trap 'exit 143' TERM
mv() {
  if [[ \${!#} == "$WORK/progress" ]]; then cat "$WORK/progress.next" >>"$FIXTURE/history"; fi
  command mv "$@"
}
`;

function transferFixture(stream: string, exitCode = 0) {
  const f = fixture();
  const path = join(f.dir, 'curl-stream');
  writeFileSync(path, stream);
  const run = (extraCode = '', extra: NodeJS.ProcessEnv = {}) =>
    f.run(
      `${f.source}${downloadSetup}
${extraCode}
download https://fixture.invalid/archive "$WORK/archive"
cat "$WORK/progress"
[[ -z $DOWNLOAD_PID && -z $PROGRESS_PID ]]
[[ ! -e $WORK/curl.progress ]]`,
      [],
      {
        FAKE_CURL_STREAM: posix(path),
        FAKE_CURL_EXIT: String(exitCode),
        ...extra,
      },
    );
  const history = () =>
    readFileSync(join(f.dir, 'history'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => Number(line.split(' ')[0]));
  return { ...f, transfer: run, history };
}

const response = (headers = 'Content-Length: 200') => `HTTP/1.1 200 OK\r\n${headers}\r\n\r\n`;

describe('Bootstrap progress (offline transfers and renderer)', { timeout: 30_000 }, () => {
  it.each([
    ['1', '3', 33],
    ['1024', '4096', 25],
    ['0', '100', 0],
    ['100', '100', 99],
    ['101', '100', 99],
    ['0008', '0010', 80],
    ['999999999999999', '999999999999999', 99],
    ['1', '0', -1],
    ['1', '', -1],
    ['-1', '100', -1],
    ['x[$(exit 91)]', '100', -1],
    ['1000000000000000', '10', -1],
  ])('computes bounded integer progress for %s / %s', (bytes, total, expected) => {
    const f = fixture();
    const result = f.run(`${f.source}\nbyte_percent "$1" "$2"; printf '%s' "$PERCENT"`, [
      String(bytes),
      String(total),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(String(expected));
  });

  it('uses real curl percentages monotonically, capping at 99 until successful exit', () => {
    const f = transferFixture(response() + '# 12.5%\r## 42.0%\r# 20.0%\r### 100.0%');
    const result = f.transfer();
    expect(result.status, result.stderr).toBe(0);
    expect(f.history()).toEqual([-1, -1, 12, 42, 42, 99, 100]);
    expect(result.stdout).toBe('100 archive\n');
    expect(result.stdout + result.stderr).not.toContain('\u001b');
    expect(f.trace()).toContain('<--retry> <3>');
    expect(f.trace()).toContain('<--proto> <=https> <--proto-redir> <=https>');
    expect(f.trace()).toContain('<--location>');
    expect(f.trace()).toContain('<--fail> <--show-error>');
    expect(existsSync(join(f.dir, 'work'))).toBe(false);
  });

  it.each([
    '',
    'Content-Length: 0',
    'Content-Length: unknown',
    'Content-Length: 900\r\nTransfer-Encoding: chunked',
    'Transfer-Encoding: chunked\r\nContent-Length: 900',
  ])('keeps unknown/encoded/empty length indeterminate: %j', (headers) => {
    const f = transferFixture(response(headers) + '### 87.0%\r<=>\r### 100.0%\r');
    const result = f.transfer();
    expect(result.status, result.stderr).toBe(0);
    expect(f.history()).toEqual([-1, -1, 100]);
  });

  it('ignores proxy/redirect sizes and never borrows a previous response length', () => {
    const f = transferFixture(
      'HTTP/1.1 200 Connection established\r\n\r\n' +
        'HTTP/1.1 302 Found\r\nContent-Length: 900\r\nLocation: https://fixture.invalid/?token=secret\r\nSet-Cookie: secret\r\n\r\n100.0%\r' +
        response('X-Secret: hidden\r\nWarning: secret header') +
        '76.0%\r',
    );
    expect(f.transfer().status).toBe(0);
    expect(f.history()).toEqual([-1, -1, -1, -1, 100]);
    const log = existsSync(join(f.dir, 'download.log'))
      ? readFileSync(join(f.dir, 'download.log'), 'utf8')
      : '';
    expect(log).not.toMatch(/secret|hidden|Location|Cookie/);
  });

  it('resets after retry notices and again on the next response, including HTTP/2', () => {
    const f = transferFixture(
      response() +
        '42.0%\r' +
        'curl: (18) partial file\nWarning: Problem. Will retry in 1 seconds. 3 retries left.\n99.0%\r' +
        'HTTP/2 200\r\ncontent-length: 10000\r\n\r\n3.0%\r100.0%\r',
    );
    const result = f.transfer();
    expect(result.status, result.stderr).toBe(0);
    expect(f.history()).toEqual([-1, -1, 42, -1, -1, -1, 3, 99, 100]);
    expect(readFileSync(join(f.dir, 'download.log'), 'utf8')).toContain('Will retry');
  });

  it.each([18, 22, 60])('never commits 100 on a failed transfer (exit %s)', (code) => {
    const f = transferFixture(
      response() + `99.9%\r100.0%\rcurl: (${code}) transfer failed\n`,
      code,
    );
    const result = f.transfer();
    expect(result.status).toBe(code);
    expect(f.history()).not.toContain(100);
    expect(result.stderr).toContain(`код ${code}`);
    expect(readFileSync(join(f.dir, 'download.log'), 'utf8')).toContain(`status=${code}`);
    expect(existsSync(join(f.dir, 'work'))).toBe(false);
  });

  it.each(['', 'curl: (7) connection refused'])(
    'drains EOF with no meter or trailing newline: %j',
    (stream) => {
      const f = transferFixture(stream, stream ? 7 : 0);
      const result = f.transfer();
      expect(result.status, result.stderr).toBe(stream ? 7 : 0);
      expect(f.history()).toEqual(stream ? [-1, -1, -1] : [-1, 100]);
    },
  );

  it.each(['INT', 'TERM'])(
    'stops curl, the reader and the renderer on %s and removes private work',
    (signal) => {
      const f = fixture();
      f.script(
        'curl',
        `
printf '%s\\n' "$BASHPID" >"$FIXTURE/curl.pid"
trap 'exit 143' TERM INT
while :; do sleep 0.05; done`,
      );
      const result = f.run(`${f.source}${downloadSetup}
RICH=1; COLOR_MODE=24; COLUMNS=80
owner=$BASHPID
(
  trap - ERR EXIT INT TERM
  for ((i=0;i<100;i++)); do
    if [[ -s $FIXTURE/curl.pid ]]; then kill -${signal} "$owner"; exit 0; fi
    sleep 0.05
  done
  kill -TERM "$owner"
) &
run_step download download https://fixture.invalid/archive "$WORK/archive"`);
      expect(result.status, result.stderr).toBe(signal === 'INT' ? 130 : 143);
      const pid = readFileSync(join(f.dir, 'curl.pid'), 'utf8').trim();
      expect(f.run('kill -0 "$1" 2>/dev/null', [pid]).status).not.toBe(0);
      expect(result.stdout).not.toContain('100%');
      expect(existsSync(join(f.dir, 'work'))).toBe(false);
      expect(readdirSync(f.dir).filter((name) => name.endsWith('.progress'))).toEqual([]);
    },
  );

  it('parses a real loopback curl meter through redirects, chunked bodies, retries and partial failures', async () => {
    // A separate Node process keeps serving while Git Bash runs synchronously.
    // Only the test wrapper permits HTTP; production keeps HTTPS-only flags.
    const server = spawn(
      process.execPath,
      [
        '-e',
        `
      const http = require('node:http'); let retries = 0;
      const server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/known', 'Content-Length': '0' }); res.end(); return;
        }
        if (req.url === '/retry' && retries++ === 0) {
          res.writeHead(503, { 'Content-Length': '0' }); res.end(); return;
        }
        if (req.url === '/unknown') res.writeHead(200);
        else res.writeHead(200, { 'Content-Length': '655360' });
        let sent = 0;
        const timer = setInterval(() => {
          res.write(Buffer.alloc(32768)); sent++;
          if (req.url === '/partial' && sent === 4) { clearInterval(timer); res.destroy(); }
          else if (sent === 20) { clearInterval(timer); res.end(); }
        }, 30);
        res.on('close', () => clearInterval(timer));
      });
      server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
    `,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      const output = server.stdout;
      if (!output) throw new Error('Fixture server stdout is unavailable');
      const [port] = await once(output, 'data');
      const realCurl = spawnSync(bash, ['-c', 'command -v curl'], {
        encoding: 'utf8',
      }).stdout.trim();
      expect(realCurl).not.toBe('');
      for (const route of ['known', 'redirect', 'unknown', 'retry', 'partial']) {
        const f = transferFixture('');
        f.script(
          'curl',
          `
args=()
while (( $# )); do
  case $1 in
    --dump-header|--proto|--proto-redir) shift 2; continue ;;
    https://fixture.invalid/*) args+=("http://127.0.0.1:$PORT/\${1##*/}") ;;
    --output)
      shift; out=$1
      if command -v cygpath >/dev/null; then out=$(cygpath -m "$out"); fi
      args+=(--output "$out") ;;
    *) args+=("$1") ;;
  esac
  shift
done
exec "$REAL_CURL" --noproxy '*' --dump-header - "\${args[@]}" 1>&2`,
        );
        const result = f.run(
          `${f.source}${downloadSetup}
download https://fixture.invalid/${route} "$WORK/archive"`,
          [],
          {
            PORT: String(port).trim(),
            REAL_CURL: realCurl,
          },
        );
        expect(result.status, `${route}: ${result.stderr}`).toBe(route === 'partial' ? 18 : 0);
        const values = f.history();
        if (route === 'unknown')
          expect(values.every((value) => value === -1 || value === 100)).toBe(true);
        // Some curl versions keep their meter indeterminate after a retry.
        else if (route !== 'retry')
          expect(
            values.some((value) => value > 0 && value < 100),
            `${route}: ${values}`,
          ).toBe(true);
        if (route === 'partial') expect(values).not.toContain(100);
        else expect(values.at(-1)).toBe(100);
        expect(result.stdout + result.stderr).not.toContain('%');
      }
    } finally {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  });

  it('cannot consume the remaining piped script while downloading', () => {
    const f = transferFixture(response() + '100.0%\r');
    f.script(
      'curl',
      `cat >/dev/null\nprintf 'HTTP/1.1 200 OK\\r\\nContent-Length: 1\\r\\n\\r\\n100.0%%\\r' >&2`,
    );
    const result = f.run('printf "%s\\n" "$PIPE_HARNESS" | bash', [], {
      PIPE_HARNESS: `${f.source}${downloadSetup}\ndownload https://fixture.invalid/archive "$WORK/archive"\nprintf 'download-tail survived\\n'`,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('download-tail survived\n');
  });

  it.each([20, 40, 80, 160])(
    'draws two unclipped rows with a full-width line at %s columns',
    (width) => {
      const f = fixture();
      const result = f.run(
        `${f.source}
RICH=1; RESET=$'\\033[0m'; COLOR_MODE=24; COLUMNS=$1
STEP='4/6 · Node and Corepack with a long title'
render_frame 50 archive.tar.xz 0`,
        [String(width)],
      );
      expect(result.status, result.stderr).toBe(0);
      const lines = plain(result.stdout).split('\n');
      const [label = '', track = ''] = lines;
      expect(lines).toHaveLength(2);
      expect(label).toContain('50%');
      expect(label.length).toBeLessThan(width);
      expect(track).toMatch(/^ {2}[━─]+$/);
      expect(track).toHaveLength(width - 2);
      expect(track.match(/━/g)).toHaveLength(Math.floor((width - 4) / 2));
      expect(result.stdout).toContain('[38;2;160;160;160m');
      expect(result.stdout).toContain('\u001b[J');
    },
  );

  it.each([20, 80, 160])(
    'sweeps through every track cell, including the last, at %s columns',
    (width) => {
      const f = fixture();
      const result = f.run(
        `${f.source}
RICH=1; RESET=$'\\033[0m'; COLOR_MODE=24; COLUMNS=$1; STEP=download
for ((phase=0;phase<768;phase+=19)); do render_frame -1 archive "$phase"; printf '\\n'; done`,
        [String(width)],
      );
      expect(result.status, result.stderr).toBe(0);
      const tracks = plain(result.stdout)
        .split('\n')
        .filter((line) => line.startsWith('  '));
      expect(tracks.length).toBeGreaterThan(30);
      for (let cell = 0; cell < width - 4; cell++) {
        expect(
          tracks.some((track) => track[cell + 2] === '━'),
          `cell ${cell}`,
        ).toBe(true);
      }
      expect(result.stdout).not.toContain('%');
    },
  );

  it('closes the six-second palette cycle and freezes phase for reduced motion', () => {
    const f = fixture();
    const result = f.run(`${f.source}
COLOR_MODE=24
for time in 0 2000000 4000000 6000000; do
  brand_phase "$time"; gradient_shade 0 80 "$PHASE"; printf '%s\\n' "$SHADE"
done
LCT_REDUCED_MOTION=1
brand_phase 4000000; gradient_shade 0 80 "$PHASE"; printf '%s\\n' "$SHADE"`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('\n').slice(0, -1)).toEqual([
      '\u001b[38;2;160;160;160m',
      '\u001b[38;2;208;208;208m',
      '\u001b[38;2;240;240;240m',
      '\u001b[38;2;160;160;160m',
      '\u001b[38;2;160;160;160m',
    ]);
  });

  it.each([
    ['truecolor', 'xterm-256color', 24],
    ['24bit', 'screen', 24],
    ['', 'xterm-kitty', 24],
    ['', 'xterm-direct', 24],
    ['', 'xterm-256color', 256],
    ['', 'xterm', 16],
    ['', 'vt100', 16],
    ['', 'unknown', 0],
  ])('selects color depth for COLORTERM=%s TERM=%s', (color, term, depth) => {
    const f = fixture();
    const result = f.run(
      `${f.source}\nselect_palette; printf '%s\\n' "$COLOR_MODE"; gradient_shade 0 80 0; printf '%s' "$SHADE"`,
      [],
      {
        COLORTERM: String(color),
        TERM: String(term),
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${depth}\n`);
    if (depth === 24) expect(result.stdout).toContain('[38;2;160;160;160m');
    else if (depth === 256) expect(result.stdout).toContain('[38;5;247m');
    else if (depth === 16) expect(result.stdout).toContain('\u001b[37m');
    else expect(result.stdout).not.toContain('\u001b');
  });

  it('keeps redirected/no-color/dumb output plain and retains the initial banner and steps', () => {
    const f = fixture();
    for (const extra of [
      { NO_COLOR: '', TERM: 'xterm' },
      { TERM: 'dumb' },
      { COLORTERM: 'truecolor' },
    ]) {
      const result = f.run(
        `${f.source}\ninit_ui; show_banner\nLOG="$FIXTURE/plain.log"\nrun_step '1/6 · Prepare' printf private`,
        [],
        extra,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('LCT26 · Дизайнер презентаций');
      expect(result.stdout).toContain('· 1/6 · Prepare');
      expect(result.stdout).toContain('✓ 1/6 · Prepare');
      expect(result.stdout).not.toContain('\r');
      expect(result.stdout).not.toContain('\u001b');
    }
  });

  it('renders a gradient banner and heading without overflowing a narrow terminal', () => {
    const f = fixture();
    const result = f.run(
      `${f.source}\nRICH=1; RESET=$'\\033[0m'; COLOR_MODE=24; COLUMNS=20; show_banner`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('[38;2;');
    expect(
      plain(result.stdout)
        .split('\n')
        .every((line) => line.length < 20),
    ).toBe(true);
  });

  it('redraws reduced-motion frames only on state changes and clears resized/reflowed content', () => {
    const f = fixture();
    const result = f.run(`${f.source}
WORK="$FIXTURE/work"; mkdir "$WORK"; STEP=download
RICH=1; RESET=$'\\033[0m'; COLOR_MODE=24; LCT_REDUCED_MOTION=1; COLUMNS=80
# Drive the real loop deterministically: idle, progress change, then resize.
sleep() {
  tick=$((tick + 1))
  case $tick in
    2) write_progress 42 archive ;;
    4) COLUMNS=20 ;;
    6) exit 0 ;;
  esac
}
tick=0
spinner`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('\u001b[J')).toHaveLength(4);
    expect(plain(result.stdout)).toContain('42%');
    expect(plain(result.stdout)).not.toContain('100%');
  });
});
