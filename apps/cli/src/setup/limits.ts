import { join } from 'node:path';
import { EnvFile } from './env-file.js';
import { repoRoot } from './stack.js';
import { ask } from './terminal.js';
import * as p from './ui.js';

const LIMITS = [
  {
    flag: 'model-concurrency',
    key: 'MODEL_MAX_CONCURRENCY',
    label: 'Одновременные запросы к моделям',
    min: 1,
    max: 64,
    fallback: '8',
  },
  {
    flag: 'deadline-ms',
    key: 'GENERATION_DEADLINE_MS',
    label: 'Бюджет генерации, мс',
    min: 60000,
    max: 290000,
    fallback: '290000',
  },
  {
    flag: 'generation-concurrency',
    key: 'GENERATION_CONCURRENCY',
    label: 'Параллельные задачи слайдов',
    min: 1,
    max: 6,
    fallback: '3',
  },
] as const;

export function setLimits(env: EnvFile, flags: Record<string, string>): void {
  const values = LIMITS.map((limit) => {
    const value = flags[limit.flag] ?? env.get(limit.key) ?? limit.fallback;
    if (!/^\d+$/.test(value) || Number(value) < limit.min || Number(value) > limit.max)
      throw new Error(`--${limit.flag}: целое число от ${limit.min} до ${limit.max}.`);
    return { key: limit.key, value };
  });
  for (const { key, value } of values) env.set(key, value);
}

export async function limitsCommand(flags: Record<string, string> = {}): Promise<number> {
  const root = repoRoot();
  const env = EnvFile.open(join(root, '.env'), join(root, '.env.example'));
  const values = { ...flags };
  if (values.yes !== 'true')
    for (const limit of LIMITS) {
      values[limit.flag] ??= await ask(() =>
        p.text({
          message: `${limit.label} (${limit.min}–${limit.max})`,
          defaultValue: env.get(limit.key) || limit.fallback,
          validate: (v) =>
            /^\d+$/.test(v ?? '') && Number(v) >= limit.min && Number(v) <= limit.max
              ? undefined
              : 'Число вне допустимого диапазона',
        }),
      );
    }
  setLimits(env, values);
  env.save();
  p.log.success('Лимиты сохранены. Применить: lct restart api');
  return 0;
}
