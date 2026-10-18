/**
 * UI-only grouping for the model picker. A manufacturer is a company, not a model family and not
 * a capability. Server URLs and connection names are never a manufacturer.
 *
 * Classification reads the model id only. A vendor prefix does not hide the model name, and a
 * protocol is not a company: gpt://folder/qwen3/latest is Alibaba.
 */

export const MANUFACTURERS = [
  'openai',
  'anthropic',
  'google',
  'alibaba',
  'deepseek',
  'xai',
  'meta',
  'mistral',
  'cohere',
  'microsoft',
  'zhipu',
  'yandex',
] as const;

export type Manufacturer = (typeof MANUFACTURERS)[number];

/** A named company, or other when the id matches none of them. */
export type ManufacturerId = Manufacturer | 'other';

/** Company names shown in the picker. all and other stay in translations. */
export const MANUFACTURER_LABEL: Record<Manufacturer, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  alibaba: 'Alibaba',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  meta: 'Meta',
  mistral: 'Mistral',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
  zhipu: 'Zhipu AI',
  yandex: 'Yandex',
};

/**
 * First match wins, so a namespace does not swallow the model (openai/qwen is Alibaba) and
 * gpt:// stays a protocol.
 */
const PATTERNS: readonly { readonly id: Manufacturer; readonly pattern: RegExp }[] = [
  { id: 'anthropic', pattern: /claude/i },
  { id: 'google', pattern: /(?:^|[^a-z0-9])(?:gemini|gemma)(?:[^a-z0-9]|$)/i },
  { id: 'alibaba', pattern: /qwen/i },
  { id: 'deepseek', pattern: /deepseek/i },
  { id: 'meta', pattern: /llama/i },
  {
    id: 'mistral',
    pattern: /(?:^|[^a-z0-9])(?:mistral|mixtral|pixtral|codestral)(?:[^a-z0-9]|$)/i,
  },
  { id: 'xai', pattern: /grok/i },
  { id: 'cohere', pattern: /(?:^|[^a-z0-9])command(?:[^a-z0-9]|$)/i },
  { id: 'microsoft', pattern: /(?:^|[^a-z0-9])phi(?:[^a-z0-9]|$)/i },
  { id: 'zhipu', pattern: /(?:^|[^a-z0-9])(?:glm|chatglm)(?:[^a-z0-9]|$)/i },
  { id: 'yandex', pattern: /(?:^|[^a-z0-9])(?:yandex(?:gpt)?|alice(?:ai)?)(?:[^a-z0-9]|$)/i },
  // Last: a gpt:// prefix is a protocol, not the company.
  { id: 'openai', pattern: /(?:^|[^a-z0-9])(?:gpt|chatgpt|o[134])(?:[^a-z0-9]|$)/i },
];

/** The company behind a model id. Unknown, empty and URL-shaped ids are other. */
export function modelManufacturer(modelId: string): ManufacturerId {
  const id = modelId.trim();
  if (id === '' || /^https?:\/\//i.test(id)) return 'other';
  const hosted = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/([^/]+)(?:\/[^/]+)?$/i.exec(id);
  const name = hosted?.[1] ?? id;
  for (const { id: manufacturer, pattern } of PATTERNS) {
    if (pattern.test(name)) return manufacturer;
  }
  return 'other';
}
