import { dependencyKey } from '../generation/checkpoints.js';
import { attemptTask } from './attempt-context.js';

export interface AttemptLedger {
  begin(intent: {
    taskKey: string;
    modelId: string;
    kind: string;
    reservedTokens: number;
    estimatedCost: number | null;
    pricingVersion: string | null;
    currency: string | null;
    connectionId?: string;
    connectionScope?: 'personal' | 'shared' | 'server';
  }): Promise<string>;
  end(
    id: string,
    outcome: {
      status: string;
      httpStatus: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      actualCost: number | null;
    },
  ): Promise<void>;
}
export interface TokenPrice {
  version: string;
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Instruments the physical fetch: negotiation sends and retries cannot bypass accounting. */
export function ledgerFetch(
  ledger: AttemptLedger,
  kind: string,
  transport: typeof fetch = fetch,
  prices?: TokenPrice | ((model: string) => TokenPrice | undefined),
  connection?: { connectionId: string; connectionScope?: 'personal' | 'shared' | 'server' },
): typeof fetch {
  return async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    let request: Record<string, unknown> = {};
    try {
      request = JSON.parse(body) as Record<string, unknown>;
    } catch {
      /* Non-JSON asset download. */
    }
    const maximum = count(request.max_completion_tokens ?? request.max_tokens) ?? 0;
    const price =
      typeof prices === 'function'
        ? prices(typeof request.model === 'string' ? request.model : '')
        : prices;
    // UTF-8 bytes are an explicit conservative input reservation, not reported usage.
    const inputReserve = Buffer.byteLength(body, 'utf8');
    const cost = price
      ? (inputReserve * price.inputPerMillion + maximum * price.outputPerMillion) / 1_000_000
      : null;
    const id = await ledger.begin({
      taskKey: attemptTask() ?? dependencyKey({ kind, body }),
      modelId: typeof request.model === 'string' ? request.model : 'asset-download',
      kind,
      reservedTokens: inputReserve + maximum,
      estimatedCost: cost,
      pricingVersion: price?.version ?? null,
      currency: price?.currency ?? null,
      ...(connection
        ? { connectionId: connection.connectionId, connectionScope: connection.connectionScope }
        : {}),
    });
    let response: Response;
    try {
      init?.signal?.throwIfAborted();
      response = await transport(url, init);
    } catch (error) {
      await ledger.end(id, {
        status: 'unknown-outcome',
        httpStatus: null,
        inputTokens: null,
        outputTokens: null,
        actualCost: null,
      });
      throw error;
    }
    const finish = async (text: string, interrupted = false) => {
      let data: Record<string, unknown> = {};
      let valid = true;
      const stream = response.headers.get('content-type')?.includes('text/event-stream');
      try {
        if (stream) {
          for (const line of text.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (raw === '[DONE]') continue;
            const event = JSON.parse(raw) as Record<string, unknown>;
            const message = event.message as Record<string, unknown> | undefined;
            const delta = event.delta as Record<string, unknown> | undefined;
            const usage = event.usage ?? message?.usage;
            if (usage) data.usage = { ...(data.usage as object), ...(usage as object) };
            if (event.choices) data.choices = event.choices;
            if (delta?.stop_reason) data.stop_reason = delta.stop_reason;
          }
        } else {
          const parsed: unknown = JSON.parse(text);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) valid = false;
          else data = parsed as Record<string, unknown>;
        }
      } catch {
        valid = false;
      }
      const usage = data.usage as
        | {
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
            input_tokens?: unknown;
            output_tokens?: unknown;
            cache_creation_input_tokens?: unknown;
            cache_read_input_tokens?: unknown;
          }
        | undefined;
      const baseInput = count(usage?.prompt_tokens ?? usage?.input_tokens);
      const cacheCreation = count(usage?.cache_creation_input_tokens) ?? 0;
      const cacheRead = count(usage?.cache_read_input_tokens) ?? 0;
      const inputTokens = baseInput === null ? null : baseInput + cacheCreation + cacheRead;
      const outputTokens = count(usage?.completion_tokens ?? usage?.output_tokens);
      const choices = data.choices as { finish_reason?: string }[] | undefined;
      await ledger.end(id, {
        status: interrupted
          ? 'unknown-outcome'
          : !response.ok
            ? 'http-error'
            : !valid
              ? 'invalid-response'
              : choices?.some((choice) => choice.finish_reason === 'length') ||
                  data.stop_reason === 'max_tokens' ||
                  data.stop_reason === 'model_context_window_exceeded'
                ? 'truncated-response'
                : 'response-received',
        httpStatus: response.status,
        inputTokens,
        outputTokens,
        actualCost:
          price &&
          cacheCreation === 0 &&
          cacheRead === 0 &&
          inputTokens !== null &&
          outputTokens !== null
            ? (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) /
              1_000_000
            : null,
      });
    };
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      let text: string;
      try {
        text = await response.clone().text();
      } catch (error) {
        await finish('', true);
        throw error;
      }
      await finish(text);
      return response;
    }
    // Preserve first-token streaming. EOF is not exposed until the ledger is durable.
    const reader = response.body?.getReader();
    if (!reader) {
      await finish('', true);
      return response;
    }
    const decoder = new TextDecoder();
    let tail = '';
    let ended = false;
    const complete = async (interrupted: boolean) => {
      if (!ended) {
        ended = true;
        await finish(tail, interrupted);
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) {
            tail += decoder.decode();
            await complete(false);
            controller.close();
          } else {
            tail = (tail + decoder.decode(part.value, { stream: true })).slice(-262144);
            controller.enqueue(part.value);
          }
        } catch (error) {
          await complete(true);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        await complete(true);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
