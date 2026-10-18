import type { ModelDetails, ModelKind, ReasoningCapability } from '@lct/contracts';

/**
 * What a provider says about a model in its `/models` answer, beyond the id. OpenAI returns ids
 * only, but many servers describe their models, each in its own words:
 *
 * - VK AI Space: `model_type` (llm, vlm, stt, embedding…), `tasks`, `input_modalities`, `tags`
 *   (`thinking-mode`, `reasoning`);
 * - OpenRouter: `architecture.input_modalities` / `output_modalities`, `supported_parameters`;
 * - new-api gateways: `supported_endpoint_types` (`image-generation`, `video`, `embeddings`…);
 * - LiteLLM and others: `mode`, `type`, `capabilities`.
 *
 * Only what is said is taken; a model described in none of these words gets no details and is
 * treated as the settings decide for an undescribed model. Nothing here asks the model anything.
 */

const words = (value: unknown): string[] => {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(words);
  if (value !== null && typeof value === 'object') {
    // `capabilities: { vision: true, completion: true }`
    return Object.entries(value)
      .filter(([, on]) => on === true)
      .map(([name]) => name.toLowerCase());
  }
  return [];
};

const has = (list: readonly string[], ...needles: string[]) =>
  list.some((item) =>
    needles.some((needle) => item === needle || item.replace(/[_\s]/g, '-') === needle),
  );

/** The kinds a model is said to be, or undefined when nothing about its kind is said. */
function kindsOf(item: Record<string, unknown>): ModelKind[] | undefined {
  const architecture = (item.architecture ?? {}) as Record<string, unknown>;
  const type = words([item.model_type, item.type, item.mode, item.task, item.tasks]);
  const input = words([item.input_modalities, architecture.input_modalities, item.modalities]);
  const output = words([item.output_modalities, architecture.output_modalities]);
  const capabilities = words(item.capabilities);
  const endpoints = words(item.supported_endpoint_types);
  const said = type.length + input.length + output.length + capabilities.length + endpoints.length;
  if (said === 0) return undefined;

  const speech =
    has(
      type,
      'stt',
      'asr',
      'transcription',
      'audio-transcription',
      'speech-to-text',
      'speech-recognition',
    ) || has(capabilities, 'transcription', 'speech-to-text');
  const image =
    has(type, 'image', 'image-generation', 'text-to-image', 'diffusion') ||
    has(output, 'image') ||
    has(endpoints, 'image-generation');
  const notChat =
    has(
      type,
      'embedding',
      'embeddings',
      'reranker',
      'reranking',
      'rerank',
      'tts',
      'text-to-speech',
      'video',
      'text-to-video',
    ) || has(endpoints, 'video', 'embeddings', 'jina-rerank');
  const vision =
    has(type, 'vlm', 'vision', 'image-text-to-text') ||
    has(input, 'image', 'vision') ||
    has(capabilities, 'vision', 'image-input');
  const chat =
    !speech &&
    !notChat &&
    (has(
      type,
      'llm',
      'vlm',
      'chat',
      'chat-completion',
      'completion',
      'text-generation',
      'image-text-to-text',
    ) ||
      has(output, 'text') ||
      has(capabilities, 'completion', 'chat') ||
      // A gateway that serves it through the chat formats and not only through images or video.
      (endpoints.length > 0 &&
        !image &&
        has(endpoints, 'openai', 'anthropic', 'gemini', 'openai-response')));

  // Whether it reads pictures is said only by input modalities or a vision type. A gateway that
  // lists only its chat formats does not say, and a model nobody said cannot see is offered for
  // pictures too, as an undescribed model is: the person can correct it.
  const inputSaid = input.length > 0 || has(type, 'llm', 'vlm', 'vision');
  const kinds: ModelKind[] = [];
  if (chat) kinds.push('text');
  if (chat && (vision || !inputSaid)) kinds.push('vision');
  if (image) kinds.push('image');
  if (speech) kinds.push('speech');
  return kinds;
}

/**
 * How the model thinks, when the provider says so. `thinking-mode` is a switch through the chat
 * template; a `reasoning` parameter (OpenRouter) or `reasoning_effort` takes a depth.
 */
function reasoningOf(item: Record<string, unknown>): ReasoningCapability | undefined {
  const tags = words([item.tags, item.capabilities]);
  const parameters = words(item.supported_parameters);
  if (has(parameters, 'reasoning-effort', 'reasoning')) {
    return { toggle: 'reasoning-effort', levels: true };
  }
  if (has(tags, 'thinking-mode', 'hybrid-thinking')) {
    return { toggle: 'enable-thinking', levels: false };
  }
  return undefined;
}

/** The details of every described model of a `/models` answer, by id. */
export function modelDetailsOf(body: unknown): Record<string, ModelDetails> {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return {};
  const details: Record<string, ModelDetails> = {};
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string') continue;
    const kinds = kindsOf(record);
    const reasoning = reasoningOf(record);
    if (kinds || reasoning) {
      details[record.id.trim()] = {
        ...(kinds ? { kinds } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    }
  }
  return details;
}
