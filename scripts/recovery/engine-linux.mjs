import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const args = [
  'run',
  '--rm',
  '--name',
  'lct-recovery-checks',
  '--env',
  'UV_PROJECT_ENVIRONMENT=/tmp/recovery-venv',
  '--env',
  'PYTHONPATH=/app/engine/src',
];
for (const folder of [
  'engine',
  'tools',
  'packages/contracts',
  'packages/slide-audit',
  'packages/pipeline',
  'configs',
  'scripts/recovery',
  'infra',
  'public',
  'docs',
  'runs',
])
  args.push('--mount', `type=bind,source=${resolve(folder)},target=/app/${folder}`);
const evidence = process.argv[2] === '--evidence';
args.push(
  '--entrypoint',
  'uv',
  'lct26-engine:latest',
  'run',
  '--locked',
  ...(evidence
    ? ['python', 'scripts/recovery/evidence.py', 'runs/recovery-runtime']
    : ['pytest', ...process.argv.slice(2)]),
);
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
