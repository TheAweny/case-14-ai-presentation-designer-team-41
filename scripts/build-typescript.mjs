import { cpSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = { api: 'apps/api', 'run-store': 'packages/run-store' };
const name = process.argv[2];
if (!Object.hasOwn(projects, name)) throw new Error('Unknown TypeScript build target.');
const project = resolve(workspace, projects[name]);
const output = join(project, 'dist');
if (relative(workspace, output).startsWith('..') || dirname(output) !== project) {
  throw new Error('Build output must remain inside the selected project.');
}
rmSync(output, { recursive: true, force: true });
const compiled = spawnSync(
  process.execPath,
  [
    join(workspace, 'node_modules/typescript/bin/tsc'),
    '-p',
    name === 'api' ? 'tsconfig.build.json' : 'tsconfig.lib.json',
  ],
  {
    cwd: project,
    stdio: 'inherit',
  },
);
// Libraries use tsconfig.lib.json, applications tsconfig.build.json.
if (compiled.error) throw compiled.error;
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
if (name === 'run-store')
  cpSync(join(project, 'migrations'), join(output, 'migrations'), { recursive: true });
