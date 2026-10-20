import { anthropicTransport, type AnthropicTransportOptions } from '@lct/pipeline';
import type { ResolvedModel } from './model-settings.service.js';

/** Protocol is chosen by the saved connection, never inferred from a model name or hostname. */
export function modelTransport(
  model: Pick<ResolvedModel, 'protocol'>,
  transport: typeof fetch,
  options: AnthropicTransportOptions = {},
): typeof fetch {
  return model.protocol === 'anthropic' ? anthropicTransport(transport, options) : transport;
}
