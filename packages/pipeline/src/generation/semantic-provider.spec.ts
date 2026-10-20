import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compositionCritiqueSchema } from '@lct/contracts';
import { CheckpointTextProvider, TaskCheckpoints } from './checkpoints.js';
import { SemanticAuditBindingError, SemanticTextProvider } from './semantic-provider.js';
import type { TextProvider } from './provider.js';

describe('shared semantic audit', () => {
  it('retains valid and joined findings when another binding is unknown', async () => {
    const provider = new SemanticTextProvider({
      model: 'fake',
      async generate(_agent, _instructions, _input, schema) {
        return schema.parse({
          issues: [
            {
              slideIndex: 0,
              slotId: 'semantic-0,semantic-99',
              category: 'factual-error',
              message: 'Check condition',
            },
          ],
        });
      },
    });
    const caught = await provider
      .generate(
        'critic',
        '',
        {
          brief: 'Fact',
          approvedOutline: null,
          proposedOutline: null,
          slides: [
            {
              slideIndex: 0,
              approvedSlide: null,
              speakerNotes: '',
              visual: null,
              texts: [{ slotId: 'real', text: 'Fact' }],
            },
          ],
        },
        compositionCritiqueSchema,
        new AbortController().signal,
      )
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(SemanticAuditBindingError);
    expect((caught as SemanticAuditBindingError).partial.issues).toEqual([
      { slideIndex: 0, slotId: 'real', category: 'factual-error', message: 'Check condition' },
    ]);
  });
  it('audits identical facts once, remaps findings and reuses the accepted audit after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'semantic-audit-'));
    let sends = 0;
    const raw: TextProvider = {
      model: 'fake',
      async generate(_agent, _instructions, _input, schema) {
        sends++;
        return schema.parse({
          issues: [
            {
              slideIndex: 0,
              slotId: 'semantic-0',
              category: 'factual-error',
              message: 'Unsupported claim',
            },
          ],
          coverage: [],
        });
      },
    };
    const provider = () =>
      new SemanticTextProvider(
        new CheckpointTextProvider(raw, new TaskCheckpoints(directory, 'spec')),
      );
    const input = (slotId: string, text = '18 % in 2026') => ({
      brief: '18 % in 2026',
      approvedOutline: null,
      proposedOutline: null,
      contentHash: slotId,
      contentRevision: 1,
      slides: [
        {
          slideIndex: 0,
          approvedSlide: null,
          patternId: slotId,
          speakerNotes: '',
          visual: null,
          texts: [
            {
              slotId,
              text,
              role: 'body',
              maxChars: slotId.length * 100,
              fitChars: 400,
              sample: slotId,
            },
          ],
        },
      ],
    });
    try {
      const shared = provider();
      const results = await Promise.all(
        ['left', 'right', 'lower'].map((id) =>
          shared.generate(
            'critic',
            'registry instructions',
            input(id),
            compositionCritiqueSchema,
            new AbortController().signal,
          ),
        ),
      );
      expect(sends).toBe(1);
      expect(results.map((result) => result.issues[0]?.slotId)).toEqual(['left', 'right', 'lower']);
      await provider().generate(
        'critic',
        'registry instructions',
        input('new-shape-id'),
        compositionCritiqueSchema,
        new AbortController().signal,
      );
      expect(sends).toBe(1);
      await shared.generate(
        'critic',
        'registry instructions',
        input('left', '19 % in 2026'),
        compositionCritiqueSchema,
        new AbortController().signal,
      );
      expect(sends).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
