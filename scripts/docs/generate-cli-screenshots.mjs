import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'lct-docs-screenshots-'));
const scenes = ['bootstrap', 'menu', 'model', 'settings', 'summary', 'users', 'progress'];
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
try {
  for (const scene of scenes) {
    run(process.execPath, ['scripts/docs/capture-cli.mjs', scene, join(scratch, `${scene}.ansi`)]);
  }
  run('uv', [
    'run',
    '--no-project',
    '--with',
    'pillow==12.3.0',
    '--with',
    'pyte==0.8.2',
    'scripts/docs/render-cli.py',
    scratch,
  ]);
  const images = join(root, 'apps/docs/public/images/cli');
  mkdirSync(images, { recursive: true });
  for (const scene of scenes)
    copyFileSync(join(scratch, `${scene}.png`), join(images, `${scene}.png`));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
