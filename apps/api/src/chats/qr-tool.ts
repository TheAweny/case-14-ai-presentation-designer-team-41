import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { qrCodePartSchema, qrUrlSchema, type QrCodePart } from '@lct/contracts';
import { generateQrCode, minimumQrSizeEmu, qrUrlsInText, type ChatTool } from '@lct/pipeline';
import type { ChatToolScope } from './chat-tools.js';
import { chatSourceFacts } from './source-provenance.js';

const fileInput = z.object({ fileId: z.string().uuid() });
const readOutput = z
  .object({
    name: z.string().max(300),
    text: z.string().max(8000),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
    totalChars: z.number().int().nonnegative(),
  })
  .strict();
const extractOutput = z
  .object({
    fileId: z.string().uuid(),
    name: z.string().max(300),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    text: z.string().max(6000),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    totalChars: z.number().int().nonnegative(),
    coordinateSystem: z.literal('prepared-text-utf16'),
  })
  .strict();

interface Provenance {
  source: QrCodePart['source'];
  reachability: QrCodePart['reachability'];
}

/** No model text, snippets, or URL arguments can attest a source. */
function provenance(scope: ChatToolScope, url: string): Provenance | null {
  const messages = scope.messages();
  const fetched = chatSourceFacts(messages).filter((fact) => fact.kind === 'fetch_source');
  // chatSourceFacts validates the full successful result, including public requested/final URLs.
  for (const fact of fetched) {
    const message = messages.find((item) => item.id === fact.messageId);
    const part =
      message?.role === 'assistant'
        ? message.parts.find((item) => item.type === 'tool' && item.callId === fact.callId)
        : undefined;
    const requested =
      part?.type === 'tool' ? z.object({ requestedUrl: qrUrlSchema }).safeParse(part.output) : null;
    const request =
      part?.type === 'tool' ? z.object({ url: qrUrlSchema }).safeParse(part.input) : null;
    if (
      !requested?.success ||
      !request?.success ||
      new URL(request.data.url).href !== requested.data.requestedUrl
    )
      continue;
    if (
      (fact.url === url || (requested?.success && requested.data.requestedUrl === url)) &&
      z.iso.datetime({ offset: true }).safeParse(fact.fetchedAt).success
    ) {
      return {
        source: { kind: 'web-source', messageId: fact.messageId, callId: fact.callId },
        reachability: { status: 'fetched', fetchedAt: fact.fetchedAt },
      };
    }
  }
  const files = new Set<string>();
  for (const message of messages) {
    if (message.role === 'user') {
      for (const attachment of message.attachments) {
        if (attachment.kind === 'file') files.add(attachment.fileId);
      }
      if (qrUrlsInText(message.text).includes(url)) {
        return {
          source: { kind: 'user', messageId: message.id },
          reachability: { status: 'not-checked' },
        };
      }
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.status !== 'done') continue;
      if (part.name !== 'read_file' && part.name !== 'extract_material') continue;
      const input = fileInput.safeParse(part.input);
      if (!input.success || !files.has(input.data.fileId)) continue;
      const parsed =
        part.name === 'read_file'
          ? readOutput.safeParse(part.output)
          : extractOutput.safeParse(part.output);
      if (!parsed.success) continue;
      const data = parsed.data;
      if ('fileId' in data && data.fileId !== input.data.fileId) continue;
      const truncated = 'truncated' in data ? data.truncated : data.hasMore;
      if (
        data.offset + data.text.length > data.totalChars ||
        (data.nextOffset === null && data.offset + data.text.length !== data.totalChars) ||
        (data.nextOffset !== null && data.nextOffset >= data.totalChars) ||
        truncated !== (data.nextOffset !== null) ||
        (data.nextOffset !== null && data.nextOffset !== data.offset + data.text.length)
      )
        continue;
      if (
        !qrUrlsInText(data.text, {
          startComplete: data.offset === 0,
          endComplete: data.nextOffset === null,
        }).includes(url)
      )
        continue;
      return {
        source: {
          kind: 'material',
          messageId: message.id,
          callId: part.callId,
          fileId: input.data.fileId,
        },
        reachability: { status: 'not-checked' },
      };
    }
  }
  return null;
}

function metadata(part: QrCodePart) {
  const { pngDataUrl: _png, type: _type, callId: _call, ...output } = part;
  return output;
}

/** One bounded cache per actual chat turn. Creating the PNG never contacts the destination. */
export function qrTool(scope: ChatToolScope): ChatTool {
  const cache = new Map<string, Promise<QrCodePart>>();
  const inputSchema = z.object({ url: qrUrlSchema }).strict();
  return {
    name: 'generate_qr',
    input: inputSchema,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const { url } = inputSchema.parse(input);
      const evidence = provenance(scope, url);
      if (!evidence)
        throw new Error('QR URL must exactly match a user URL or a successful source read.');
      const previous = cache.get(url);
      if (previous) {
        const part = await previous;
        context.signal.throwIfAborted();
        return { output: metadata(part) };
      }
      if (cache.size >= 8) throw new Error('At most eight unique QR codes are allowed per turn.');
      const pending = (async () => {
        const image = await generateQrCode(url);
        context.signal.throwIfAborted();
        return qrCodePartSchema.parse({
          type: 'qr-code',
          callId: context.callId,
          qrId: randomUUID(),
          url,
          pngDataUrl: `data:image/png;base64,${image.png.toString('base64')}`,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
          moduleCount: image.moduleCount,
          minSizeEmu: minimumQrSizeEmu(image.moduleCount),
          ...evidence,
        });
      })();
      cache.set(url, pending);
      try {
        const part = await pending;
        context.signal.throwIfAborted();
        // The evidence must still belong to this live context after asynchronous encoding.
        if (!provenance(scope, url)) throw new Error('QR source is no longer in this chat.');
        if (scope.currentMessageId) {
          const live = scope.messages().find((message) => message.id === scope.currentMessageId);
          if (live?.role !== 'assistant' || live.status !== 'streaming') {
            throw new Error('The QR turn is no longer active.');
          }
        }
        context.signal.throwIfAborted();
        context.show(part);
        return { output: metadata(part) };
      } catch (error) {
        cache.delete(url);
        throw error;
      }
    },
  };
}
