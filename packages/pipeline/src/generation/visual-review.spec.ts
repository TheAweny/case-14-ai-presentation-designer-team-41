import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LayoutVariant, SlideIr, SlideReview } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProvider, ModelRequest } from '../models/provider.js';
import { VisionProvider } from './vision-provider.js';
import { reviewVariantVisually } from './visual-review.js';

const run = (text: string) => ({ text, font: '', sizePt: 24, bold: null, italic: null, color: '' });

function slide(id: string, index: number, headline: string, body: string): SlideIr {
  const text = (elementId: string, role: 'title' | 'body', y: number, value: string) => ({
    kind: 'text' as const,
    elementId,
    role,
    box: { x: 0, y, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [{ level: 0, lineSpacing: null, runs: [run(value)] }],
    overflow: null,
  });
  return {
    schemaVersion: 1,
    slideId: id,
    variant: 'balanced',
    index,
    patternId: 'title-body',
    slideCx: 12192000,
    slideCy: 6858000,
    elements: [text(`title-${id}`, 'title', 0, headline), text(`body-${id}`, 'body', 200, body)],
  };
}

const agent: LoadedAgent = {
  config: {
    id: 'slide-reviewer',
    version: '1.2.0',
    description: 'Reviewer.',
    modelId: 'vision-default',
    generation: { temperature: 0, topP: 1, maxOutputTokens: 2048 },
    outputSchema: 'SlideReview',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Review the slide.',
  directory: 'registry/agents/slide-reviewer',
};

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'visual-review-'));
  directories.push(path);
  return path;
}

function yes(slideId: string): SlideReview {
  return {
    schemaVersion: 1,
    slideId,
    answers: [
      { checkId: 'no-typos', verdict: 'yes', confidence: 0.9, evidence: '', suggestion: '' },
    ],
  };
}

function no(slideId: string): SlideReview {
  return {
    schemaVersion: 1,
    slideId,
    answers: [
      { checkId: 'no-typos', verdict: 'no', confidence: 0.9, evidence: 'Revenue', suggestion: '' },
    ],
  };
}

describe('reviewVariantVisually', () => {
  it('asks the questions of the picture of every slide and returns the findings', async () => {
    const dir = await folder();
    const previews = [join(dir, 'slide-1.png'), join(dir, 'slide-2.png')];
    await Promise.all(previews.map((p) => writeFile(p, 'png-bytes')));
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      name: 'scripted',
      complete: (request) => {
        requests.push(request);
        const slideId = (request.input as { slideId: string }).slideId;
        const review: SlideReview = {
          schemaVersion: 1,
          slideId,
          answers:
            slideId === 's1'
              ? [
                  {
                    checkId: 'no-service-text',
                    verdict: 'no',
                    confidence: 0.95,
                    evidence: 'Retention',
                    suggestion: '',
                  },
                ]
              : [
                  {
                    checkId: 'no-typos',
                    verdict: 'yes',
                    confidence: 0.9,
                    evidence: '',
                    suggestion: '',
                  },
                ],
        };
        return Promise.resolve(JSON.stringify(review));
      },
    };
    const result = await reviewVariantVisually({
      engine: {
        importDeck: () =>
          Promise.resolve({
            schemaVersion: 1,
            slides: [
              slide('s1', 0, 'Retention', 'Retention rose to 94%.'),
              slide('s2', 1, 'Revenue', 'Revenue grew.'),
            ],
          }),
      },
      agent,
      provider,
      brief: 'Retention rose to 94% in the pilot.',
      goal: 'Show the pilot worked.',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews,
      seed: 1,
      outputDir: dir,
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.images).toEqual([
        `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      ]);
    }
    expect(result.slideCount).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ origin: 'contextual', target: { slideId: 's1' } });
    expect(result.reviews).toHaveLength(2);
    expect(result.pictures).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it.each([
    {
      name: 'missing',
      previews: (dir: string) => [join(dir, 'missing.png')],
    },
    {
      name: 'unreadable',
      previews: (dir: string) => [join(dir, 'no-such-directory', 'slide-1.png')],
    },
    {
      name: 'empty',
      previews: async (dir: string) => {
        const empty = join(dir, 'slide-1.png');
        await writeFile(empty, '');
        return [empty];
      },
    },
  ])('records a failure and does not call the model for a $name preview', async ({ previews }) => {
    const dir = await folder();
    const paths = await previews(dir);
    let calls = 0;
    const result = await reviewVariantVisually({
      engine: {
        importDeck: () =>
          Promise.resolve({
            schemaVersion: 1,
            slides: [slide('s1', 0, 'One', 'Text')],
          }),
      },
      agent,
      provider: {
        name: 'scripted',
        complete: () => {
          calls += 1;
          return Promise.resolve(JSON.stringify(yes('s1')));
        },
      },
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews: paths,
      seed: 1,
      outputDir: dir,
    });
    expect(calls).toBe(0);
    expect(result.failures).toEqual([{ slideId: 's1', error: 'Slide preview unavailable.' }]);
    expect(result.pictures).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.reviews).toEqual([]);
  });

  it('does not import or call the model when the signal is already aborted', async () => {
    const dir = await folder();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    let imports = 0;
    let calls = 0;
    await expect(
      reviewVariantVisually({
        engine: {
          importDeck: () => {
            imports += 1;
            return Promise.resolve({
              schemaVersion: 1,
              slides: [slide('s1', 0, 'One', 'Text')],
            });
          },
        },
        agent,
        provider: {
          name: 'scripted',
          complete: () => {
            calls += 1;
            return Promise.resolve('{}');
          },
        },
        brief: 'Brief',
        goal: '',
        pptxPath: join(dir, 'deck.pptx'),
        mediaDir: join(dir, 'media'),
        previews: [join(dir, 'missing.png')],
        seed: 1,
        outputDir: dir,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(imports).toBe(0);
    expect(calls).toBe(0);
    await expect(readFile(join(dir, 'audit-contextual.json'))).rejects.toThrow();
  });

  it('drops a late model answer and does not write the audit after cancellation', async () => {
    const dir = await folder();
    const preview = join(dir, 'slide-1.png');
    await writeFile(preview, 'png-bytes');
    const controller = new AbortController();
    let release: (answer: string) => void = () => undefined;
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = reviewVariantVisually({
      engine: {
        importDeck: () =>
          Promise.resolve({
            schemaVersion: 1,
            slides: [slide('s1', 0, 'One', 'Text')],
          }),
      },
      agent,
      provider: {
        name: 'late',
        complete: () => {
          started();
          return new Promise<string>((resolve) => {
            release = resolve;
          });
        },
      },
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews: [preview],
      seed: 1,
      outputDir: dir,
      signal: controller.signal,
    });
    const settled = pending.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    await startedPromise;
    controller.abort(new Error('review deadline'));
    release(
      JSON.stringify({
        schemaVersion: 1,
        slideId: 's1',
        answers: [
          {
            checkId: 'no-typos',
            verdict: 'yes',
            confidence: 0.9,
            evidence: '',
            suggestion: '',
          },
        ],
      }),
    );
    expect(await settled).toBe('rejected');
    await expect(readFile(join(dir, 'audit-contextual.json'))).rejects.toThrow();
  });
});

describe('reviewVariantVisually asked again about some slides', () => {
  it('asks only about them and keeps the earlier answers for the rest', async () => {
    const dir = await folder();
    const previews = [join(dir, 'slide-1.png'), join(dir, 'slide-2.png')];
    await Promise.all(previews.map((p) => writeFile(p, 'png-bytes')));
    const asked: string[] = [];
    const answer = (slideId: string, verdict: 'yes' | 'no'): SlideReview => ({
      schemaVersion: 1,
      slideId,
      answers: [
        { checkId: 'no-typos', verdict, confidence: 0.9, evidence: 'Revenue', suggestion: '' },
      ],
    });
    const provider: ModelProvider = {
      name: 'scripted',
      complete: (request) => {
        const slideId = (request.input as { slideId: string }).slideId;
        asked.push(slideId);
        return Promise.resolve(JSON.stringify(answer(slideId, 'yes')));
      },
    };
    const engine = {
      importDeck: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          slides: [slide('s1', 0, 'One', 'Retention'), slide('s2', 1, 'Two', 'Revenue')],
        }),
    };
    const earlier = await reviewVariantVisually({
      engine,
      agent,
      provider: {
        name: 'scripted',
        complete: (request) => {
          const slideId = (request.input as { slideId: string }).slideId;
          return Promise.resolve(JSON.stringify(answer(slideId, 'no')));
        },
      },
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews,
      seed: 1,
      outputDir: dir,
    });
    expect(earlier.findings.map((f) => f.target.slideId).sort()).toEqual(['s1', 's2']);
    expect(earlier.pictures).toBe(2);

    const again = await reviewVariantVisually({
      engine,
      agent,
      provider,
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews,
      seed: 1,
      outputDir: dir,
      only: new Set([2]),
      previous: earlier,
    });
    expect(asked).toEqual(['s2']);
    expect(again.findings.map((f) => f.target.slideId)).toEqual(['s1']);
    expect(again.reviews.map((r) => r.slideId).sort()).toEqual(['s1', 's2']);
    expect(again.pictures).toBe(1);
    expect(again.failures).toEqual([]);
  });

  it('drops the old finding of a failed targeted recheck and keeps the rest', async () => {
    const dir = await folder();
    const previews = [join(dir, 'slide-1.png'), join(dir, 'slide-2.png')];
    await Promise.all(previews.map((p) => writeFile(p, 'png-bytes')));
    const engine = {
      importDeck: () =>
        Promise.resolve({
          schemaVersion: 1 as const,
          slides: [slide('s1', 0, 'One', 'Retention'), slide('s2', 1, 'Two', 'Revenue')],
        }),
    };
    const earlier = await reviewVariantVisually({
      engine,
      agent,
      provider: {
        name: 'scripted',
        complete: (request) => {
          const slideId = (request.input as { slideId: string }).slideId;
          return Promise.resolve(JSON.stringify(no(slideId)));
        },
      },
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews,
      seed: 1,
      outputDir: dir,
    });
    expect(earlier.findings.map((f) => f.target.slideId).sort()).toEqual(['s1', 's2']);

    let calls = 0;
    const again = await reviewVariantVisually({
      engine,
      agent,
      provider: {
        name: 'scripted',
        complete: () => {
          calls += 1;
          return Promise.resolve('not-json');
        },
      },
      brief: 'Brief',
      goal: '',
      pptxPath: join(dir, 'deck.pptx'),
      mediaDir: join(dir, 'media'),
      previews,
      seed: 1,
      outputDir: dir,
      only: new Set([2]),
      previous: earlier,
    });
    expect(calls).toBe(2);
    expect(again.findings.map((f) => f.target.slideId)).toEqual(['s1']);
    expect(again.reviews.map((r) => r.slideId)).toEqual(['s1']);
    expect(again.failures.map((f) => f.slideId)).toEqual(['s2']);
    expect(again.pictures).toBe(1);
  });
});

describe('reviewVariantVisually stamps the asked density on findings', () => {
  it.each(['dense', 'airy'] as const)(
    'targets findings at the %s variant',
    async (variant: LayoutVariant) => {
      const dir = await folder();
      const preview = join(dir, 'slide-1.png');
      await writeFile(preview, 'png-bytes');
      const result = await reviewVariantVisually({
        engine: {
          importDeck: () =>
            Promise.resolve({ schemaVersion: 1, slides: [slide('s1', 0, 'One', 'Text')] }),
        },
        agent,
        provider: {
          name: 'scripted',
          complete: (request) => {
            const slideId = (request.input as { slideId: string }).slideId;
            return Promise.resolve(
              JSON.stringify({
                schemaVersion: 1,
                slideId,
                answers: [
                  {
                    checkId: 'no-typos',
                    verdict: 'no',
                    confidence: 0.9,
                    evidence: 'Text',
                    suggestion: '',
                  },
                ],
              }),
            );
          },
        },
        brief: 'Brief',
        goal: '',
        pptxPath: join(dir, 'deck.pptx'),
        mediaDir: join(dir, 'media'),
        previews: [preview],
        seed: 1,
        outputDir: dir,
        variant,
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.target).toMatchObject({ slideId: 's1', variant });
      expect(result.pictures).toBe(1);
    },
  );
});

describe('reviewVariantVisually that is stopped', () => {
  it('cancels the requests in flight and writes nothing after the stop', async () => {
    const dir = await folder();
    const preview = join(dir, 'slide-1.png');
    await writeFile(preview, 'png-bytes');
    const stop = new AbortController();
    let cancelled = 0;
    const provider: ModelProvider = {
      name: 'hangs',
      complete: (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener('abort', () => {
            cancelled += 1;
            reject(new Error('cancelled'));
          });
          setTimeout(() => stop.abort(), 10);
        }),
    };
    await expect(
      reviewVariantVisually({
        engine: {
          importDeck: () =>
            Promise.resolve({ schemaVersion: 1, slides: [slide('s1', 0, 'One', 'Text')] }),
        },
        agent,
        provider,
        brief: 'Brief',
        goal: '',
        pptxPath: join(dir, 'deck.pptx'),
        mediaDir: join(dir, 'media'),
        previews: [preview],
        seed: 1,
        outputDir: dir,
        signal: stop.signal,
      }),
    ).rejects.toThrow();
    expect(cancelled).toBeGreaterThan(0);
    await expect(readFile(join(dir, 'audit-contextual.json'), 'utf8')).rejects.toThrow();
  });
});

describe('VisionProvider', () => {
  const request = (): ModelRequest => ({
    agent,
    input: { task: 'review-slide' },
    seed: 7,
    images: ['data:image/png;base64,AAAA'],
    responseSchema: { name: 'SlideReview', schema: { type: 'object', title: 'ReviewShape' } },
  });

  it('sends the picture, the schema and the gateway headers, and returns the raw answer', async () => {
    let seen: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const provider = new VisionProvider({
      apiKey: 'secret',
      baseUrl: 'https://gateway.test/v1/',
      model: 'qwen38-27b-fp8',
      headers: { 'Project-ID': 'project-1' },
      answerFormat: { format: 'Schema: {{schema}}', repair: 'Fix: {{problems}}' },
      fetchImpl: (_url, init) => {
        seen = {
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        };
        return Promise.resolve(
          Response.json({
            choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          }),
        );
      },
    });
    expect(await provider.complete(request())).toBe('{"ok":true}');
    const call = seen as unknown as {
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    expect(call.headers['Project-ID']).toBe('project-1');
    expect(call.headers.Authorization).toBe('Bearer secret');
    const messages = call.body.messages as { role: string; content: unknown }[];
    expect(messages[0]?.content).toContain('ReviewShape');
    expect(messages[1]?.content).toEqual([
      { type: 'text', text: '{"task":"review-slide"}' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(call.body.model).toBe('qwen38-27b-fp8');
  });

  it('stops a request when the call is cancelled, without waiting for the gateway', async () => {
    const stop = new AbortController();
    const provider = new VisionProvider({
      apiKey: '',
      baseUrl: 'https://gateway.test/v1',
      model: 'm',
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    const pending = provider.complete({ ...request(), signal: stop.signal });
    setTimeout(() => stop.abort(new Error('time is up')), 10);
    await expect(pending).rejects.toThrow('time is up');
  });

  it('asks again once the gateway says it is busy', async () => {
    let calls = 0;
    const provider = new VisionProvider({
      apiKey: '',
      baseUrl: 'https://gateway.test/v1',
      model: 'm',
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response(null, { status: 429, headers: { 'retry-after': '0' } })
            : Response.json({ choices: [{ message: { content: '{}' } }] }),
        );
      },
    });
    expect(await provider.complete(request())).toBe('{}');
    expect(calls).toBe(2);
  });

  it('gives up on an error that is not a matter of load, naming the model and no key', async () => {
    const provider = new VisionProvider({
      apiKey: 'secret',
      baseUrl: 'https://gateway.test/v1',
      model: 'm',
      fetchImpl: () => Promise.resolve(new Response('no', { status: 401 })),
    });
    await expect(provider.complete(request())).rejects.toThrow('HTTP 401 for m');
  });

  it('refuses an address that carries credentials', () => {
    expect(
      () => new VisionProvider({ apiKey: '', baseUrl: 'https://user:pw@host/v1', model: 'm' }),
    ).toThrow();
  });
});
