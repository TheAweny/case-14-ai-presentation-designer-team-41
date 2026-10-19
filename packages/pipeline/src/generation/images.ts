import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { backoff, RequestLimiter, sharedModelLimiter, retryDelay } from './provider.js';

/** Sizes every OpenAI-compatible image server accepts; a slot's box picks the nearest shape. */
export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** The size whose shape is closest to a box: wide, square or tall. */
export function sizeFor(box: { cx: number; cy: number }): ImageSize {
  const ratio = box.cx / Math.max(1, box.cy);
  if (ratio >= 1.25) return '1536x1024';
  if (ratio <= 0.8) return '1024x1536';
  return '1024x1024';
}

export interface ImageRequest {
  prompt: string;
  size: ImageSize;
  seed: number;
}

export interface GeneratedImage {
  bytes: Buffer;
  extension: 'png' | 'jpg';
}

/** A text-to-image model. The fake one draws without a network, for tests and offline demos. */
export interface ImageProvider {
  readonly model: string;
  generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage>;
}

/**
 * Pictures drawn at once for the whole process. An image server is slower and scarcer than a
 * text one, so it gets its own small pool and never takes a text slot away from the writer.
 */
const IMAGE_CONCURRENT = Math.max(1, Number(process.env.IMAGE_MAX_CONCURRENCY) || 3);
const pictures = new RequestLimiter(IMAGE_CONCURRENT);

/** One picture may take this long; a slower server leaves the slide without it, not the deck. */
const IMAGE_TIMEOUT_MS = 90_000;

interface ImagesAnswer {
  data?: { b64_json?: string; url?: string }[];
}

/** Which of the two formats the bytes are, by their signature. */
function extensionOf(bytes: Buffer): 'png' | 'jpg' {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  throw new Error('The image server answered with neither a PNG nor a JPEG.');
}

/**
 * `POST {baseUrl}/images/generations` of the OpenAI API, which vLLM-, ComfyUI- and cloud servers
 * of open text-to-image weights speak. Asks for base64 and accepts a URL when the server only
 * gives one. 429, 502, 503 and a dropped connection are retried twice with backoff.
 */
export class OpenAICompatibleImageProvider implements ImageProvider {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly queueGroup: string;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
    queueGroup?: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.queueGroup = options.queueGroup ?? 'images';
  }

  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    const release = await pictures.acquire(signal);
    try {
      for (let attempt = 0; ; attempt++) {
        const call = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]);
        let response: Response;
        const releaseModel = await sharedModelLimiter().acquire(call, this.queueGroup);
        try {
          response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
            method: 'POST',
            redirect: 'error',
            signal: call,
            headers: {
              'content-type': 'application/json',
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: this.model,
              prompt: request.prompt,
              size: request.size,
              n: 1,
              seed: request.seed,
              response_format: 'b64_json',
            }),
          });
        } catch (error) {
          signal.throwIfAborted();
          if (attempt < 2) {
            await backoff(1500 * (attempt + 1), signal);
            continue;
          }
          throw new Error(
            `Image API unreachable: ${error instanceof Error ? error.message : 'network error'}`,
            { cause: error },
          );
        } finally {
          releaseModel();
        }
        if ([429, 502, 503].includes(response.status) && attempt < 2) {
          const delay = retryDelay(attempt, response.headers.get('retry-after'));
          if (response.status !== 502) sharedModelLimiter().throttle(delay);
          await backoff(delay, signal);
          continue;
        }
        // The body of an error may echo the request; only the status leaves this function.
        if (!response.ok) throw new Error(`Image API responded ${response.status}.`);
        const answer = (await response.json()) as ImagesAnswer;
        const first = answer.data?.[0];
        if (first?.b64_json) {
          const bytes = Buffer.from(first.b64_json, 'base64');
          return { bytes, extension: extensionOf(bytes) };
        }
        if (first?.url) {
          const file = await this.fetchImpl(first.url, { signal: call });
          if (!file.ok) throw new Error(`Image download responded ${file.status}.`);
          const bytes = Buffer.from(await file.arrayBuffer());
          return { bytes, extension: extensionOf(bytes) };
        }
        throw new Error('Image API answered without a picture.');
      }
    } finally {
      release();
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG of one colour: the smallest honest picture a test can put in a slot. */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).fill(Buffer.from(rgb))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draws a picture of one colour, the same for the same prompt, at a tenth of the asked size. No
 * network: pipeline tests and offline demos run through the whole illustration path with it.
 */
export class FakeImageProvider implements ImageProvider {
  readonly model = 'fake-image';
  readonly requests: ImageRequest[] = [];

  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    signal.throwIfAborted();
    this.requests.push(request);
    const [width = 1024, height = 1024] = request.size.split('x').map(Number);
    const digest = createHash('sha256').update(request.prompt).digest();
    const bytes = solidPng(Math.round(width / 10), Math.round(height / 10), [
      digest[0] ?? 0,
      digest[1] ?? 0,
      digest[2] ?? 0,
    ]);
    return { bytes, extension: 'png' };
  }
}
