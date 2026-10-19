import { describe, expect, it } from 'vitest';
import { editorSnapshotSaveResponseSchema, type SlideIr } from '@lct/contracts';
import {
  applyAck,
  createEditorSession,
  decideOpen,
  initialSyncState,
  nextAttempt,
  SnapshotConflictError,
  type EditorTransport,
} from './editor-sync';

const deckId = 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40';

function slides(text: string): SlideIr[] {
  return [
    {
      schemaVersion: 1,
      slideId: 's1',
      variant: 'balanced',
      index: 0,
      patternId: 'synthetic',
      slideCx: 100,
      slideCy: 100,
      elements: [
        {
          kind: 'text',
          elementId: 't',
          role: 'title',
          box: { x: 0, y: 0, cx: 10, cy: 10 },
          sourceShapeId: null,
          paragraphs: [
            {
              level: 0,
              runs: [{ text, font: '', sizePt: 12, bold: null, italic: null, color: '' }],
              lineSpacing: null,
            },
          ],
          overflow: null,
        },
      ],
    },
  ];
}

function saved(text: string, revision: number) {
  const parsed = editorSnapshotSaveResponseSchema.parse({
    schemaVersion: 1,
    kind: 'saved',
    snapshot: {
      schemaVersion: 1,
      deckId,
      revision,
      base: 'base-1',
      savedAt: '2026-10-19T00:00:00.000Z',
      contentSha256: 'ab'.repeat(32),
      slides: slides(text),
      media: [],
    },
  });
  if (parsed.kind !== 'saved') throw new Error('expected a saved revision');
  return parsed;
}

describe('decideOpen', () => {
  const origin = slides('origin');
  const edited = slides('edited');

  it('opens a local draft only when the server has no revision and the base matches', () => {
    expect(
      decideOpen({
        originBase: 'base-1',
        originSlides: origin,
        server: null,
        local: { base: 'base-1', slides: edited },
      }),
    ).toEqual({ kind: 'legacy', slides: edited });
    expect(
      decideOpen({
        originBase: 'base-1',
        originSlides: origin,
        server: null,
        local: { base: 'other', slides: edited },
      }),
    ).toEqual({ kind: 'origin' });
  });

  it('does not cover a server revision with the local draft', () => {
    const decision = decideOpen({
      originBase: 'base-1',
      originSlides: origin,
      server: { revision: 2, base: 'base-1', slides: origin },
      local: { base: 'base-1', slides: edited },
    });
    expect(decision.kind).toBe('choose');
    if (decision.kind !== 'choose') return;
    expect(decision.serverRevision).toBe(2);
    expect(decision.localSlides).toEqual(edited);
  });

  it('opens the server copy when the local draft matches it', () => {
    expect(
      decideOpen({
        originBase: 'base-1',
        originSlides: origin,
        server: { revision: 2, base: 'base-1', slides: edited },
        local: { base: 'base-1', slides: edited },
      }),
    ).toEqual({ kind: 'server', slides: edited, revision: 2 });
  });
});

describe('applyAck', () => {
  it('ignores a saved revision older than the one already accepted', () => {
    const current = {
      ...initialSyncState(),
      expectedRevision: 2,
      ackedRevision: 2,
      ackedSlides: slides('new'),
    };
    expect(applyAck(current, saved('old', 1), slides('old'))).toBe(current);
  });

  it('keeps a conflict beside the accepted copy', () => {
    const conflict = editorSnapshotSaveResponseSchema.parse({
      schemaVersion: 1,
      kind: 'conflict',
      conflict: {
        schemaVersion: 1,
        conflictId: '6d1c0c3e-5b1a-4c2d-9e3f-1a2b3c4d5e6f',
        expectedRevision: 1,
        server: saved('server', 2).snapshot,
        rejected: { base: 'base-1', slides: slides('mine'), media: [] },
      },
    });
    const next = applyAck(
      { ...initialSyncState(), expectedRevision: 1, ackedRevision: 1, ackedSlides: slides('server') },
      conflict,
      slides('mine'),
    );
    expect(next.conflict?.conflictId).toBe('6d1c0c3e-5b1a-4c2d-9e3f-1a2b3c4d5e6f');
    expect(next.ackedRevision).toBe(1);
  });
});

describe('nextAttempt', () => {
  it('reuses the key for the same slides and mints a new one after they change', () => {
    let n = 0;
    const first = nextAttempt(initialSyncState(), slides('a'), () => `key-${(n += 1)}`);
    const retry = nextAttempt(first.state, slides('a'), () => `key-${(n += 1)}`);
    const changed = nextAttempt(first.state, slides('b'), () => `key-${(n += 1)}`);
    expect(retry.key).toBe(first.key);
    expect(changed.key).not.toBe(first.key);
  });
});

describe('EditorSession', () => {
  it('publishes only after the picture is stored and repeats the same attempt key', async () => {
    const calls: { path: string; body: unknown }[] = [];
    let failOnce = true;
    const transport: EditorTransport = {
      async json(path, init) {
        calls.push({ path, body: init?.body });
        if (path.endsWith('/media')) {
          return {
            status: 201,
            body: {
              schemaVersion: 1,
              media: {
                mediaPart: 'upload/a.png',
                sha256: 'cd'.repeat(32),
                byteSize: 1,
                contentType: 'image/png',
              },
            },
          };
        }
        if (failOnce) {
          failOnce = false;
          return { status: 500, body: { message: 'Сеть оборвалась.' } };
        }
        return { status: 200, body: saved('Hi', 1) };
      },
      async bytes() {
        return new Uint8Array();
      },
    };
    const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' });
    const picture = slides('Hi');
    picture[0]?.elements.push({
      kind: 'image',
      elementId: 'p',
      role: 'image',
      box: { x: 0, y: 0, cx: 10, cy: 10 },
      sourceShapeId: null,
      mediaPart: 'upload/a.png',
      fit: 'contain',
    });
    const session = createEditorSession(transport, () => 'attempt-1');
    await expect(
      session.publish(deckId, 'base-1', picture, { file: () => png }),
    ).rejects.toThrow('Сеть оборвалась.');
    await session.publish(deckId, 'base-1', picture, { file: () => png });
    const saves = calls.filter((call) => call.path.endsWith('/snapshot'));
    expect(calls[0]?.path.endsWith('/media')).toBe(true);
    expect(saves).toHaveLength(2);
    expect(saves[0]?.body).toMatchObject({ idempotencyKey: 'attempt-1', expectedRevision: 0 });
    expect(saves[1]?.body).toMatchObject({ idempotencyKey: 'attempt-1' });
    expect(session.state.ackedRevision).toBe(1);
  });

  it('reports a conflict and lets the user save again at the server revision', async () => {
    const conflict = {
      schemaVersion: 1,
      kind: 'conflict',
      conflict: {
        schemaVersion: 1,
        conflictId: '6d1c0c3e-5b1a-4c2d-9e3f-1a2b3c4d5e6f',
        expectedRevision: 0,
        server: saved('server', 1).snapshot,
        rejected: { base: 'base-1', slides: slides('mine'), media: [] },
      },
    };
    let step = 0;
    const transport: EditorTransport = {
      async json() {
        step += 1;
        if (step === 1) return { status: 409, body: conflict };
        return { status: 200, body: saved('mine', 2) };
      },
      async bytes() {
        return new Uint8Array();
      },
    };
    const session = createEditorSession(transport, () => `key-${step}`);
    await expect(session.publish(deckId, 'base-1', slides('mine'), { file: () => null })).rejects.toBeInstanceOf(
      SnapshotConflictError,
    );
    expect(session.state.conflict?.server.revision).toBe(1);
    session.keepMine();
    expect(session.state.conflict).toBeNull();
    expect(session.state.expectedRevision).toBe(1);
    await session.publish(deckId, 'base-1', slides('mine'), { file: () => null });
    expect(session.state.ackedRevision).toBe(2);
  });
});
