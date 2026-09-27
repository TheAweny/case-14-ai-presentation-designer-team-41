import type { ModelCatalog } from '@lct/contracts';
import { resolveModel } from '@lct/registry';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { RecordedProvider } from './recorded.js';
import type { ModelProvider } from './provider.js';

export { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './openai-compatible.js';
export {
  DEFAULT_RECORDINGS_DIR,
  RecordedProvider,
  type RecordedProviderOptions,
} from './recorded.js';
export {
  extractJson,
  InvalidModelAnswerError,
  requestKey,
  runAgent,
  type ModelProvider,
  type ModelRequest,
} from './provider.js';

/** Environment the providers read. Keys and URLs never live in the repository. */
export interface ProviderEnv {
  readonly MODEL_PROVIDER?: string;
  readonly MODEL_API_KEY?: string;
  readonly MODEL_JSON_MODE?: string;
  readonly RECORDINGS_DIR?: string;
  readonly [name: string]: string | undefined;
}

/**
 * The provider for a model id, chosen by the catalogue and the environment.
 *
 * MODEL_PROVIDER=fake answers every role from recordings, which is how the tests and the offline
 * demo run; MODEL_PROVIDER=record calls the live runtime and records what it says. Otherwise the
 * catalogue entry decides, and a live runtime is reached at the URL in its baseUrlEnv.
 */
export function createProvider(
  catalog: ModelCatalog,
  modelId: string,
  env: ProviderEnv = process.env,
): ModelProvider {
  const mode = env.MODEL_PROVIDER;
  const model = resolveModel(catalog, modelId);
  if (mode === 'fake' || model.provider === 'fake') {
    return new RecordedProvider({ dir: env.RECORDINGS_DIR });
  }
  const baseUrl = env[model.baseUrlEnv];
  if (!baseUrl) {
    throw new Error(`${model.baseUrlEnv} is not set: no runtime to serve "${model.id}".`);
  }
  // A hosted provider names models its own way; LLM_MODEL, VLM_MODEL and IMAGE_MODEL override
  // the served name without touching the pinned catalogue entry.
  const servedName = env[model.baseUrlEnv.replace(/_BASE_URL$/, '_MODEL')];
  const live = new OpenAICompatibleProvider({
    model: servedName ? { ...model, servedName } : model,
    baseUrl,
    apiKey: env.MODEL_API_KEY ?? '',
    jsonMode: env.MODEL_JSON_MODE !== 'off',
  });
  if (mode === 'record') {
    return new RecordedProvider({ dir: env.RECORDINGS_DIR, mode: 'record', live });
  }
  return live;
}
