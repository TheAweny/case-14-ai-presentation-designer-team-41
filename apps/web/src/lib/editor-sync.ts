import {
  editorMediaPutResponseSchema,
  editorSnapshotLoadSchema,
  editorSnapshotSaveResponseSchema,
  type EditorConflict,
  type EditorMediaRef,
  type EditorSnapshot,
  type EditorSnapshotSaveResponse,
  type SlideIr,
} from '@lct/contracts';
import { apiFetch } from './api';
import { sameSlides, uploadPartsOf } from './deck-draft';
import { uploadedMedia, type MediaRegistry } from './media-registry';

/**
 * Серверная редакция колоды и локальная копия. «Сохранено» — только после ответа сервера.
 * Поздний ответ с меньшим номером редакции не откатывает уже принятую. Повтор той же
 * попытки уходит с тем же ключом идемпотентности; новая правка получает новый ключ.
 */

export interface SyncState {
  readonly expectedRevision: number;
  readonly ackedRevision: number | null;
  readonly ackedSlides: readonly SlideIr[] | null;
  readonly conflict: EditorConflict | null;
  readonly attemptKey: string | null;
  readonly attemptSlides: readonly SlideIr[] | null;
}

export function initialSyncState(): SyncState {
  return {
    expectedRevision: 0,
    ackedRevision: null,
    ackedSlides: null,
    conflict: null,
    attemptKey: null,
    attemptSlides: null,
  };
}

export type OpenDecision =
  | { readonly kind: 'origin' }
  | { readonly kind: 'server'; readonly slides: readonly SlideIr[]; readonly revision: number }
  | { readonly kind: 'legacy'; readonly slides: readonly SlideIr[] }
  | {
      readonly kind: 'choose';
      readonly serverSlides: readonly SlideIr[];
      readonly serverRevision: number;
      readonly localSlides: readonly SlideIr[];
    };

/**
 * Что открыть. Локальный черновик сам ложится на колоду только когда серверной редакции
 * ещё нет и отпечаток совпал. Более новую серверную редакцию он не закрывает: это выбор человека.
 */
export function decideOpen(input: {
  readonly originBase: string;
  readonly originSlides: readonly SlideIr[];
  readonly server: { readonly revision: number; readonly base: string; readonly slides: readonly SlideIr[] } | null;
  readonly local: { readonly base: string; readonly slides: readonly SlideIr[] } | null;
}): OpenDecision {
  const server = input.server;
  // Чужой отпечаток колоды не читаем — так же поступает `readDraft`.
  const local = input.local?.base === input.originBase ? input.local : null;
  const legacy = local !== null && !sameSlides(local.slides, input.originSlides) ? local : null;
  if (!server) return legacy ? { kind: 'legacy', slides: legacy.slides } : { kind: 'origin' };
  // Снимок уже на экране. Другая локальная копия — даже если это исходная колода —
  // не ложится поверх: её сохраняют явно, с expectedRevision сервера.
  if (local && !sameSlides(local.slides, server.slides)) {
    return {
      kind: 'choose',
      serverSlides: server.slides,
      serverRevision: server.revision,
      localSlides: local.slides,
    };
  }
  return { kind: 'server', slides: server.slides, revision: server.revision };
}

/**
 * `stale`, когда номер ответа меньше уже принятого в этой вкладке: назад вкладку не откатываем.
 * Равный номер — повтор той же записи.
 */
export function applyAck(acked: number | null, responseRevision: number): 'applied' | 'stale';
/** Целый ответ. Устаревший номер возвращает прежнее состояние и не подменяет слайды. */
export function applyAck(
  state: SyncState,
  response: EditorSnapshotSaveResponse,
  sent: readonly SlideIr[],
): SyncState;
export function applyAck(
  ackedOrState: number | null | SyncState,
  responseOrRevision: number | EditorSnapshotSaveResponse,
  sent?: readonly SlideIr[],
): 'applied' | 'stale' | SyncState {
  if (typeof responseOrRevision === 'number') {
    const acked = typeof ackedOrState === 'number' ? ackedOrState : null;
    if (acked !== null && responseOrRevision < acked) return 'stale';
    return 'applied';
  }
  const state = ackedOrState as SyncState;
  const response = responseOrRevision;
  if (sent === undefined) return state;
  if (response.kind === 'saved') {
    if (applyAck(state.ackedRevision, response.snapshot.revision) === 'stale') return state;
    const finished = state.attemptSlides !== null && sameSlides(state.attemptSlides, sent);
    return {
      expectedRevision: response.snapshot.revision,
      ackedRevision: response.snapshot.revision,
      ackedSlides: response.snapshot.slides,
      conflict: null,
      attemptKey: finished ? null : state.attemptKey,
      attemptSlides: finished ? null : state.attemptSlides,
    };
  }
  const serverRevision = response.conflict.server.revision;
  if (applyAck(state.ackedRevision, serverRevision) === 'stale') return state;
  if (
    state.ackedRevision === serverRevision &&
    state.ackedSlides !== null &&
    sameSlides(sent, state.ackedSlides)
  ) {
    return state;
  }
  return { ...state, conflict: response.conflict };
}

/** Ключ попытки. Тот же набор слайдов после сбоя повторяет ключ, другая правка берёт новый. */
export function nextAttempt(
  state: SyncState,
  slides: readonly SlideIr[],
  newKey: () => string,
): { readonly state: SyncState; readonly key: string } {
  if (state.attemptKey && state.attemptSlides && sameSlides(state.attemptSlides, slides)) {
    return { state, key: state.attemptKey };
  }
  const key = newKey();
  return { state: { ...state, attemptKey: key, attemptSlides: slides }, key };
}

export class SnapshotConflictError extends Error {
  readonly kind = 'conflict' as const;
  constructor(readonly conflict: EditorConflict) {
    super('conflict');
    this.name = 'SnapshotConflictError';
  }
}

export interface EditorTransport {
  json(
    path: string,
    init?: { readonly method?: string; readonly body?: unknown },
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  bytes(path: string): Promise<Uint8Array>;
}

export function browserEditorTransport(): EditorTransport {
  return {
    async json(path, init) {
      const response = await apiFetch(path, {
        method: init?.method ?? 'GET',
        headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    async bytes(path) {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error(`Picture API: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export interface EditorFileSource {
  file(mediaPart: string): Blob | null;
}

export interface EditorSession {
  readonly state: SyncState;
  load(deckId: string): Promise<EditorSnapshot | null | 'unavailable'>;
  publish(
    deckId: string,
    base: string,
    slides: readonly SlideIr[],
    files: EditorFileSource,
  ): Promise<void>;
  acceptServer(): EditorSnapshot | null;
  keepMine(): void;
  restoreMedia(deckId: string, media: readonly EditorMediaRef[], registry?: MediaRegistry): Promise<void>;
}

export function createEditorSession(
  transport: EditorTransport = browserEditorTransport(),
  newKey: () => string = () => crypto.randomUUID(),
): EditorSession {
  let state = initialSyncState();
  const media = new Map<string, EditorMediaRef>();

  const remember = (snapshot: EditorSnapshot) => {
    state = {
      expectedRevision: snapshot.revision,
      ackedRevision: snapshot.revision,
      ackedSlides: snapshot.slides,
      conflict: null,
      attemptKey: null,
      attemptSlides: null,
    };
    media.clear();
    for (const item of snapshot.media) media.set(item.mediaPart, item);
  };

  return {
    get state() {
      return state;
    },
    async load(deckId) {
      try {
        const response = await transport.json(snapshotPath(deckId));
        if (response.status !== 200) return 'unavailable';
        const parsed = editorSnapshotLoadSchema.safeParse(response.body);
        if (!parsed.success) return 'unavailable';
        if (parsed.data.snapshot) remember(parsed.data.snapshot);
        return parsed.data.snapshot;
      } catch {
        return 'unavailable';
      }
    },
    async publish(deckId, base, slides, files) {
      const attempt = nextAttempt(state, slides, newKey);
      state = attempt.state;
      const refs = await mediaRefs(deckId, slides, files, media, transport);
      const response = await transport.json(snapshotPath(deckId), {
        method: 'POST',
        body: {
          schemaVersion: 1,
          expectedRevision: state.expectedRevision,
          idempotencyKey: attempt.key,
          base,
          slides,
          media: refs,
        },
      });
      const parsed = readSaveResponse(response.status, response.body);
      if (!parsed) {
        throw new Error(messageOf(response.body) ?? `Сохранение: HTTP ${response.status}`);
      }
      const next = applyAck(state, parsed, slides);
      const ignored = next === state && parsed.kind === 'conflict';
      state = next;
      if (parsed.kind === 'conflict' && !ignored) throw new SnapshotConflictError(parsed.conflict);
      if (parsed.kind === 'saved') {
        for (const item of parsed.snapshot.media) media.set(item.mediaPart, item);
      }
    },
    acceptServer() {
      const server = state.conflict?.server ?? null;
      if (!server) return null;
      remember(server);
      return server;
    },
    keepMine() {
      const server = state.conflict?.server;
      if (!server) return;
      state = {
        ...state,
        expectedRevision: server.revision,
        conflict: null,
        attemptKey: null,
        attemptSlides: null,
      };
    },
    async restoreMedia(deckId, items, registry = uploadedMedia) {
      for (const item of items) {
        media.set(item.mediaPart, item);
        if (registry.file(item.mediaPart)) continue;
        const bytes = await transport.bytes(mediaPath(deckId, item.mediaPart));
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        registry.restore(item.mediaPart, new Blob([copy], { type: item.contentType }));
      }
    },
  };
}

/** Последняя редакция для карточки результата. Сеть недоступна — `'unavailable'`, а не исходная колода. */
export async function loadPublishedDeck(
  deckId: string,
  transport: EditorTransport = browserEditorTransport(),
): Promise<EditorSnapshot | null | 'unavailable'> {
  return createEditorSession(transport).load(deckId);
}

function snapshotPath(deckId: string): string {
  return `/editor/decks/${encodeURIComponent(deckId)}/snapshot`;
}

function mediaPath(deckId: string, mediaPart: string): string {
  return `/editor/decks/${encodeURIComponent(deckId)}/media/${encodeURIComponent(mediaPart)}`;
}

function readSaveResponse(status: number, body: unknown): EditorSnapshotSaveResponse | null {
  const direct = editorSnapshotSaveResponseSchema.safeParse(body);
  if (direct.success) return direct.data;
  if (body && typeof body === 'object' && 'message' in body) {
    const nested = editorSnapshotSaveResponseSchema.safeParse(
      (body as { message: unknown }).message,
    );
    if (nested.success) return nested.data;
  }
  if (status === 200 || status === 409) return null;
  return null;
}

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('message' in body)) return null;
  const message = (body as { message: unknown }).message;
  return typeof message === 'string' ? message : null;
}

async function mediaRefs(
  deckId: string,
  slides: readonly SlideIr[],
  files: EditorFileSource,
  known: Map<string, EditorMediaRef>,
  transport: EditorTransport,
): Promise<EditorMediaRef[]> {
  const refs: EditorMediaRef[] = [];
  for (const mediaPart of uploadPartsOf(slides)) {
    const cached = known.get(mediaPart);
    const file = files.file(mediaPart);
    if (!file) {
      if (!cached) throw new Error(`Не найден файл изображения ${mediaPart}.`);
      refs.push(cached);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await sha256Hex(bytes);
    if (cached && cached.sha256 === digest && cached.byteSize === bytes.byteLength) {
      refs.push(cached);
      continue;
    }
    const type = file.type === 'image/png' || file.type === 'image/jpeg'
      ? file.type
      : mediaPart.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
    const posted = await transport.json(`/editor/decks/${encodeURIComponent(deckId)}/media`, {
      method: 'POST',
      body: { schemaVersion: 1, mediaPart, dataUrl: dataUrlOf(bytes, type) },
    });
    if (posted.status !== 200 && posted.status !== 201) {
      throw new Error(messageOf(posted.body) ?? `Картинка: HTTP ${posted.status}`);
    }
    const parsed = editorMediaPutResponseSchema.safeParse(posted.body);
    if (!parsed.success) throw new Error('Сервер вернул картинку в неожиданном виде.');
    known.set(mediaPart, parsed.data.media);
    refs.push(parsed.data.media);
  }
  return refs;
}

function dataUrlOf(bytes: Uint8Array, type: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
