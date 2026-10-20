import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeckVariant } from './workflow.js';

const AUDIENCES = ['explanation', 'customer', 'decision', 'partner', 'team'] as const;
type Audience = (typeof AUDIENCES)[number];
const OUTPUTS = ['text', 'native', 'qr'] as const;
type Output = (typeof OUTPUTS)[number];
export interface WriterModules {
  audience: Record<Audience, string>;
  density: Record<DeckVariant, string>;
  output: Record<Output, string>;
}

export async function loadWriterModules(directory: string): Promise<WriterModules> {
  const read = async <T extends string>(kind: string, names: readonly T[]) =>
    Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          (await readFile(join(directory, kind, `${name}.md`), 'utf8')).trim(),
        ]),
      ),
    ) as Record<T, string>;
  return {
    audience: await read('audience', AUDIENCES),
    density: await read('density', ['dense', 'balanced', 'airy'] as const),
    output: await read('output', OUTPUTS),
  };
}

/** Audience alone cannot turn a technical explanation into a commercial pitch. */
export function audienceModule(audience: string, goal: string): Audience {
  if (/объяс|обуч|изуч|техническ|explain|learn/iu.test(goal)) return 'explanation';
  if (/инвест|партн[её]р|invest|partner/iu.test(audience)) return 'partner';
  if (
    /клиент|покупател|customer|buyer/iu.test(audience) &&
    /куп|прод|пилот|примен|выбр|purchase|adopt/iu.test(goal)
  )
    return 'customer';
  if (
    /руковод|директор|совет|management|executive/iu.test(audience) &&
    /реш|утверд|соглас|decid|approv/iu.test(goal)
  )
    return 'decision';
  if (
    /команд|сотрудник|team/iu.test(audience) &&
    /выполн|внедр|задач|работ|deliver|execute/iu.test(goal)
  )
    return 'team';
  return 'explanation';
}

export function writerPrompt(
  base: string,
  modules: WriterModules | undefined,
  task: {
    audience: string;
    goal: string;
    variant: DeckVariant;
    output: Output;
  },
): string {
  if (!modules) return base;
  return [
    base,
    modules.audience[audienceModule(task.audience, task.goal)],
    modules.density[task.variant],
    modules.output[task.output],
  ].join('\n\n');
}
