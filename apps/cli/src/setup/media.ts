import { join } from 'node:path';
import { baseUrlProblem } from '@lct/contracts';
import { EnvFile } from './env-file.js';
import { repoRoot } from './stack.js';
import { ask } from './terminal.js';
import * as p from './ui.js';

export type MediaKind = 'speech' | 'image';

/** Separate credentials prevent sending a text provider's key to another service. */
export function setMedia(env: EnvFile, kind: MediaKind, flags: Record<string, string>): void {
  const prefix = kind.toUpperCase();
  const provider = flags.provider;
  if (!provider || !['openai', 'disabled'].includes(provider))
    throw new Error('Провайдер: openai или disabled.');
  const baseUrl = (flags['base-url'] ?? '').trim();
  const model = (flags.model ?? '').trim();
  if (provider === 'openai' && (!baseUrl || baseUrlProblem(baseUrl) || !model))
    throw new Error('Нужны корректный --base-url (HTTP/HTTPS) и непустой --model.');
  env.set(`${prefix}_PROVIDER`, provider);
  env.set(`${prefix}_BASE_URL`, provider === 'disabled' ? '' : baseUrl.replace(/\/+$/, ''));
  env.set(`${prefix}_MODEL`, provider === 'disabled' ? '' : model);
  env.set(`${prefix}_API_KEY`, provider === 'disabled' ? '' : (flags['api-key'] ?? ''));
}

export async function configureMedia(
  env: EnvFile,
  kind: MediaKind,
  flags: Record<string, string> = {},
): Promise<void> {
  const values = { ...flags };
  const title = kind === 'speech' ? 'Распознавание речи' : 'Генерация изображений';
  if (!values.provider && values.yes === 'true')
    throw new Error('Укажите --provider openai или disabled.');
  values.provider ??= await ask(() =>
    p.select({
      message: title,
      options: [
        {
          value: 'openai',
          label: 'OpenAI-совместимый API',
          hint: kind === 'speech' ? '/audio/transcriptions' : '/images/generations',
        },
        { value: 'disabled', label: 'Отключить' },
      ],
    }),
  );
  if (values.provider === 'openai' && values.yes !== 'true') {
    values['base-url'] ??= await ask(() =>
      p.text({
        message: 'Base URL API',
        defaultValue: env.get(`${kind.toUpperCase()}_BASE_URL`),
        validate: (v) => (!v || baseUrlProblem(v) ? 'Укажите HTTP/HTTPS URL API' : undefined),
      }),
    );
    values.model ??= await ask(() =>
      p.text({
        message: 'Идентификатор модели у провайдера',
        defaultValue: env.get(`${kind.toUpperCase()}_MODEL`),
        validate: (v) => (v?.trim() ? undefined : 'Укажите модель'),
      }),
    );
    values['api-key'] ??= await ask(() =>
      p.password({ message: 'API-ключ (пусто для локального API)' }),
    );
  }
  values['api-key'] ??= process.env[`LCT_${kind.toUpperCase()}_API_KEY`] ?? '';
  setMedia(env, kind, values);
}

export async function mediaCommand(
  kind: MediaKind,
  flags: Record<string, string> = {},
): Promise<number> {
  const root = repoRoot();
  const env = EnvFile.open(join(root, '.env'), join(root, '.env.example'));
  await configureMedia(env, kind, flags);
  env.save();
  p.log.success('Настройки сохранены. Применить: lct restart api');
  return 0;
}
