import { crc32, deflateSync } from 'node:zlib';
import { NO_REASONING_CHOICE, type ReasoningCapability } from '@lct/contracts';
import type { ResolvedModel } from './model-settings.service.js';

/**
 * What a model can do, learnt by asking it rather than by its name: a name can be anything a
 * provider chose. A few short requests answer each question, and the API keeps the answer.
 *
 * A probe that could not be completed (rate limit, server error, no network) is `unknown`: it
 * says nothing about the model, so nothing is stored and the next use asks again.
 */
export type Probed<T> = { readonly known: true; readonly value: T } | { readonly known: false };

/** Room for a model that has to think before it answers, even a little. */
const PROBE_MAX_TOKENS = 4096;
const PROBE_TIMEOUT_MS = 90000;
/** Drawing one picture takes longer than answering a question. */
const IMAGE_PROBE_TIMEOUT_MS = 180000;

/** Longer than a number with a word or two: the model worked it out in the answer. */
const VERBOSE_ANSWER = 120;
/** Thinking worth the name: several steps of a multi-step question, not a stray token or two. */
const THOUGHT = 150;
/** Any thinking at all: far more tokens than a three-digit answer needs. */
const SOME_THOUGHT = 64;
/** How much more the thinking answer must think than the quiet one to call the switch real. */
const SWITCH_RATIO = 3;
/** A value of `reasoning_effort` no server accepts: refusing it shows the server reads the field. */
const NO_SUCH_EFFORT = 'lct-probe-no-such-effort';

/**
 * How much the model thought before it answered, in tokens or near enough: the reasoning tokens
 * the server reports, the reasoning text it returned, or the completion tokens the visible answer
 * does not account for (gateways that hide the reasoning still bill it). An answer that spells its
 * working out in the reply itself is not thinking mode: the probe asks for a number only.
 */
export function reasoningAmount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const { choices, usage } = payload as {
    choices?: { message?: Record<string, unknown> }[];
    usage?: {
      completion_tokens?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
  };
  const message = choices?.[0]?.message ?? {};
  const textOf = (value: unknown): string =>
    typeof value === 'string'
      ? value
      : Array.isArray(value) || (value !== null && typeof value === 'object')
        ? JSON.stringify(value)
        : '';
  const content = typeof message.content === 'string' ? message.content : '';
  const think = /<think>([\s\S]*?)(?:<\/think>|$)/i.exec(content)?.[1] ?? '';
  const answer = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  const reasoning = [message.reasoning_content, message.reasoning, message.reasoning_details]
    .map(textOf)
    .join('')
    .concat(think)
    .trim();
  // About four characters a token: only compared with other answers of the same model.
  const written = Math.ceil(reasoning.length / 4);
  const reported = usage?.completion_tokens_details?.reasoning_tokens;
  const completion = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const verbose = answer.length > VERBOSE_ANSWER;
  const hidden = verbose ? 0 : completion - Math.ceil(answer.length / 4) - written;
  return Math.max(typeof reported === 'number' ? reported : 0, written, hidden, 0);
}

/**
 * Statuses that are about what was asked. The rest are about the moment or the account (no key,
 * no money, too many requests, a server error) and settle nothing.
 */
const refusal = (status: number) =>
  status >= 400 && status < 500 && ![401, 402, 403, 408, 429].includes(status);

/** A server error that comes back every time is the server's answer, not an accident. */
const SERVER_ERROR_TRIES = 3;
const SERVER_ERROR_PAUSE_MS = 1500;

/**
 * Sends one probe request, again after a pause while the server answers 5xx. A gateway that has
 * no route for a model on an endpoint says so with a 500 every time: after the last try that
 * counts as a refusal. Rate limits, a missing key or balance and network failures stay unsettled.
 */
async function persistently(send: () => Promise<Response>): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await send();
    } catch {
      return null;
    }
    if (response.status < 500 || attempt >= SERVER_ERROR_TRIES) {
      return response.status >= 500
        ? new Response(await response.text(), { status: 400 })
        : response;
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_ERROR_PAUSE_MS));
  }
}

interface Reply {
  /** The server took the request. */
  readonly ok: boolean;
  /** It refused for what it was asked, not for being busy or down. */
  readonly refused: boolean;
  /** Reasoning that came back with the answer; 0 when it did not think. */
  readonly amount: number;
}

async function errorText(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 500);
}

function headersOf(model: ResolvedModel, json: boolean): Record<string, string> {
  return {
    ...model.headers,
    ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

/**
 * What thinking really does on this model, learnt from the server and the model together:
 *
 * - `reasoning_effort` is the provider's when it takes `low` and `high` but refuses a value that
 *   does not exist: the server reads the field and passes it on rather than dropping it. Then
 *   the depth is a choice, and `none` is the switch when the model thinks several times less
 *   with it than without.
 * - `enable_thinking` is a switch when "on" brings real thinking and "off" does not.
 * - In both cases at least one answer must show thinking (reasoning text, reasoning tokens, or
 *   completion tokens the short answer does not explain): a server that takes the fields but
 *   never thinks offers nothing.
 */
export async function probeReasoning(
  model: ResolvedModel,
  question: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<ReasoningCapability>> {
  const endpoint = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  // Reasoning models of OpenAI take only `max_completion_tokens`; learnt from the first refusal.
  let limitField = 'max_tokens';
  const ask = async (extra: Record<string, unknown>): Promise<Reply> => {
    for (;;) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: headersOf(model, true),
          redirect: 'error',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          body: JSON.stringify({
            model: model.model,
            messages: [{ role: 'user', content: question }],
            [limitField]: PROBE_MAX_TOKENS,
            ...extra,
          }),
        });
      } catch {
        return { ok: false, refused: false, amount: 0 };
      }
      if (!response.ok) {
        const message = await errorText(response);
        if (response.status === 400 && limitField === 'max_tokens' && /max_tokens/.test(message)) {
          limitField = 'max_completion_tokens';
          continue;
        }
        return { ok: false, refused: refusal(response.status), amount: 0 };
      }
      const payload: unknown = await response.json().catch(() => null);
      return { ok: true, refused: false, amount: reasoningAmount(payload) };
    }
  };

  const plain = await ask({});
  // A model that does not chat (speech, embeddings) has no thinking to offer.
  if (!plain.ok)
    return plain.refused ? { known: true, value: NO_REASONING_CHOICE } : { known: false };
  const [off, on, low, high, none, invalid] = await Promise.all([
    ask({ chat_template_kwargs: { enable_thinking: false } }),
    ask({ chat_template_kwargs: { enable_thinking: true } }),
    ask({ reasoning_effort: 'low' }),
    ask({ reasoning_effort: 'high' }),
    ask({ reasoning_effort: 'none' }),
    ask({ reasoning_effort: NO_SUCH_EFFORT }),
  ]);
  // Thinking mode through the chat template: "on" thinks, "off" does not.
  if (on.ok && off.ok && on.amount >= THOUGHT && on.amount >= off.amount * SWITCH_RATIO) {
    return { known: true, value: { toggle: 'enable-thinking', levels: false } };
  }
  // The provider reads `reasoning_effort` and the model thinks at all: the depth is real. `none`
  // is a switch only when it makes the model think several times less than it does otherwise.
  const readsEffort = low.ok && high.ok && invalid.refused;
  const thinking = Math.max(plain.amount, low.amount, high.amount);
  if (readsEffort && thinking >= SOME_THOUGHT) {
    const switches = none.ok && thinking >= THOUGHT && none.amount * SWITCH_RATIO <= thinking;
    return {
      known: true,
      value: { toggle: switches ? 'reasoning-effort' : null, levels: true },
    };
  }
  const unsettled = [off, on, low, high, none, invalid].some(
    (reply) => !reply.ok && !reply.refused,
  );
  return unsettled ? { known: false } : { known: true, value: NO_REASONING_CHOICE };
}

/** Half a second of 16 kHz mono silence as WAV: enough for a transcription endpoint to accept. */
function silentWav(): Uint8Array {
  const samples = 8000;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/**
 * Whether the model transcribes speech: `POST /audio/transcriptions` with a moment of silence. A
 * speech model answers with a `text` field (empty for silence); any other model is refused.
 */
export async function probeSpeech(
  model: ResolvedModel,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<boolean>> {
  const body = new FormData();
  body.append('file', new Blob([silentWav()], { type: 'audio/wav' }), 'probe.wav');
  body.append('model', model.model);
  const response = await persistently(() =>
    fetchImpl(`${model.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: headersOf(model, false),
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }),
  );
  if (!response) return { known: false };
  if (!response.ok)
    return refusal(response.status) ? { known: true, value: false } : { known: false };
  const payload: unknown = await response.json().catch(() => null);
  const transcribed =
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { text?: unknown }).text === 'string';
  return { known: true, value: transcribed };
}

/** A chat request for a probe, with the switch to `max_completion_tokens` a server may ask for. */
async function chatProbe(
  model: ResolvedModel,
  content: unknown,
  maxTokens: number,
  fetchImpl: typeof fetch,
): Promise<{ readonly status: number | null; readonly payload: unknown }> {
  const endpoint = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  for (const limitField of ['max_tokens', 'max_completion_tokens']) {
    const response = await persistently(() =>
      fetchImpl(endpoint, {
        method: 'POST',
        headers: headersOf(model, true),
        redirect: 'error',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: 'user', content }],
          [limitField]: maxTokens,
        }),
      }),
    );
    if (!response) return { status: null, payload: null };
    if (response.ok)
      return { status: response.status, payload: await response.json().catch(() => null) };
    const message = await errorText(response);
    if (!(response.status === 400 && limitField === 'max_tokens' && /max_tokens/.test(message))) {
      return { status: response.status, payload: null };
    }
  }
  return { status: 400, payload: null };
}

const settled = (status: number | null, value: boolean): Probed<boolean> =>
  status !== null && (status < 300 || refusal(status)) ? { known: true, value } : { known: false };

/** Whether the model answers chat completions: the kind every text role needs. */
export async function probeChat(
  model: ResolvedModel,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<boolean>> {
  const { status, payload } = await chatProbe(model, prompt, 256, fetchImpl);
  const answered =
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray((payload as { choices?: unknown }).choices);
  return settled(status, status !== null && status < 300 && answered);
}

/** A 32×32 PNG filled with one colour: a colour any model that sees names at once. */
function square(rgb: readonly [number, number, number]): string {
  const size = 32;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill(rgb).flat())]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** The colours of the vision probe and how an answer names them. */
const SEEN_COLOURS = [
  { rgb: [255, 0, 0] as const, named: /\bred\b|красн/i },
  { rgb: [0, 0, 255] as const, named: /\bblue\b|син/i },
];

/**
 * Whether the model sees pictures: it is sent a red square and a blue one and must name both
 * colours. A gateway that drops the picture leaves the model guessing, and one guess cannot be
 * right for both.
 */
export async function probeVision(
  model: ResolvedModel,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<boolean>> {
  const answers = await Promise.all(
    SEEN_COLOURS.map(async ({ rgb, named }) => {
      const { status, payload } = await chatProbe(
        model,
        [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: square(rgb) } },
        ],
        1024,
        fetchImpl,
      );
      const content = (payload as { choices?: { message?: { content?: unknown } }[] } | null)
        ?.choices?.[0]?.message?.content;
      const answer =
        typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/gi, '') : '';
      return { status, seen: named.test(answer) };
    }),
  );
  const unsettled = answers.find((answer) => settled(answer.status, false).known === false);
  if (unsettled) return { known: false };
  return { known: true, value: answers.every((answer) => answer.seen) };
}

/**
 * Whether the model draws: the request the illustrator sends, `POST /images/generations` with
 * one square picture as base64, must come back with a picture. A model that is not an image
 * model is refused at once, so only real image models cost a drawing, once.
 */
export async function probeImage(
  model: ResolvedModel,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<boolean>> {
  const response = await persistently(() =>
    fetchImpl(`${model.baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: headersOf(model, true),
      redirect: 'error',
      signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS),
      body: JSON.stringify({
        model: model.model,
        prompt,
        size: '1024x1024',
        n: 1,
        response_format: 'b64_json',
      }),
    }),
  );
  if (!response) return { known: false };
  if (!response.ok) return settled(response.status, false);
  const payload = (await response.json().catch(() => null)) as {
    data?: { b64_json?: unknown; url?: unknown }[];
  } | null;
  const picture = payload?.data?.[0];
  return {
    known: true,
    value: typeof picture?.b64_json === 'string' || typeof picture?.url === 'string',
  };
}
