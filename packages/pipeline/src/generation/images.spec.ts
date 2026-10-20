import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import { readFileSync } from 'node:fs';
import { TaskCheckpoints } from './checkpoints.js';
import { FakeImageProvider, OpenAICompatibleImageProvider, sizeFor, solidPng } from './images.js';
import { SharedIllustrations, styleOf } from './illustrations.js';
import type { TextProvider } from './provider.js';

const png = solidPng(4, 3, [10, 200, 90]);
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const request = { prompt: 'Green office plants, no text', size: '1536x1024' as const, seed: 7 };

describe('OpenAICompatibleImageProvider', () => {
  it('asks the images endpoint for base64 and reads the picture', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const provider = new OpenAICompatibleImageProvider({
      baseUrl: 'https://images.example.test/v1/',
      apiKey: 'key',
      model: 'flux-schnell',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return answer({ data: [{ b64_json: png.toString('base64') }] });
      },
    });
    const picture = await provider.generate(request, AbortSignal.timeout(5000));
    expect(picture).toEqual({ bytes: png, extension: 'png' });
    expect(calls).toEqual([
      {
        url: 'https://images.example.test/v1/images/generations',
        body: {
          model: 'flux-schnell',
          prompt: request.prompt,
          size: '1536x1024',
          n: 1,
          seed: 7,
          response_format: 'b64_json',
        },
      },
    ]);
  });

  it('retries a busy server and downloads a picture given by URL', async () => {
    const statuses = [503, 429];
    const provider = new OpenAICompatibleImageProvider({
      baseUrl: 'https://images.example.test/v1',
      apiKey: '',
      model: 'flux',
      fetchImpl: async (url) => {
        if (String(url).endsWith('/picture.png')) return new Response(png);
        const status = statuses.shift();
        if (status) return answer({ error: 'busy' }, status);
        return answer({ data: [{ url: 'https://cdn.example.test/picture.png' }] });
      },
    });
    const picture = await provider.generate(request, AbortSignal.timeout(20000));
    expect(picture.extension).toBe('png');
    expect(statuses).toEqual([]);
  }, 20000);

  it('fails without leaking the error body', async () => {
    const provider = new OpenAICompatibleImageProvider({
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'secret',
      model: 'flux',
      fetchImpl: async () => answer({ error: 'secret echoed' }, 401),
    });
    await expect(provider.generate(request, AbortSignal.timeout(5000))).rejects.toThrow(
      'Image API responded 401.',
    );
  });
});

describe('sizeFor', () => {
  it('picks the size whose shape is closest to the slot', () => {
    expect(sizeFor({ cx: 1600, cy: 900 })).toBe('1536x1024');
    expect(sizeFor({ cx: 900, cy: 1000 })).toBe('1024x1024');
    expect(sizeFor({ cx: 500, cy: 1000 })).toBe('1024x1536');
  });
});

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
);
const designSystem = generationProfileSchema.parse(fixture.valid[0].payload).designSystem;
const registryDir = fileURLToPath(new URL('../../../../registry/agents', import.meta.url));

describe('SharedIllustrations', () => {
  const text = (prompts: unknown[]): TextProvider => ({
    model: 'fake',
    async generate<T>(agent: string, _i: string, input: unknown, schema: z.ZodType<T>) {
      expect(agent).toBe('illustrator');
      prompts.push(input);
      return schema.parse({ prompt: 'A calm green office with plants, no text, no logos.' });
    },
  });
  const slide = {
    index: 2,
    ordinal: 0,
    count: 1,
    imageQuery: 'living plants in an IT office',
    purpose: 'Plants raise productivity by 15%',
    deck: { title: 'Green office', audience: 'HR directors', goal: 'Order an eco audit' },
    box: { x: 0, y: 0, cx: 1600, cy: 900 },
  };

  it('draws a slide picture once for every variant that asks for it, in the template style', async () => {
    const images = new FakeImageProvider();
    const prompts: unknown[] = [];
    const shared = await SharedIllustrations.load(
      { images, text: text(prompts), designSystem, seed: 42, signal: AbortSignal.timeout(5000) },
      registryDir,
    );
    const [a, b] = await Promise.all([shared.request(slide), shared.request({ ...slide })]);
    expect(a).toBe(b);
    expect(images.requests).toHaveLength(1);
    expect(a).toMatchObject({ size: '1536x1024', model: 'fake-image', extension: 'png' });
    expect(prompts[0]).toMatchObject({
      picture: { shape: 'wide' },
      style: { accent: styleOf(designSystem).accent },
    });
    expect(shared.agent.config.id).toBe('illustrator');
  });

  const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.25, protection: 'none' as const };
  const frame = {
    textRegions: [region],
    textColors: ['FFFFFF'],
    crop: { l: 0.2, t: 0, r: 0, b: 0 },
    state: 'known' as const,
  };

  it('draws one task for the same frame and a new task when the frame changes', async () => {
    const images = new FakeImageProvider();
    const prompts: unknown[] = [];
    const shared = await SharedIllustrations.load(
      { images, text: text(prompts), designSystem, seed: 7, signal: AbortSignal.timeout(5000) },
      registryDir,
    );
    const first = await shared.request({ ...slide, frame });
    const again = await shared.request({
      ...slide,
      frame: {
        ...frame,
        textColors: ['ffffff'],
        textRegions: [{ ...region, x: 0.1 }],
      },
    });
    const cropped = await shared.request({
      ...slide,
      frame: { ...frame, crop: { l: 0, t: 0.25, r: 0, b: 0 } },
    });
    const plated = await shared.request({
      ...slide,
      frame: {
        ...frame,
        textRegions: [{ ...region, protection: 'solid' }],
      },
    });
    const moved = await shared.request({
      ...slide,
      frame: {
        ...frame,
        textRegions: [{ ...region, x: 0.4, width: 0.2 }],
      },
    });
    expect(again).toBe(first);
    expect(images.requests).toHaveLength(4);
    expect(cropped).not.toBe(first);
    expect(plated).not.toBe(first);
    expect(moved).not.toBe(first);
    expect(prompts[0]).toMatchObject({
      picture: { shape: 'wide', frame: { state: 'known', crop: { l: 0.2 } } },
    });
    expect(images.requests[0]?.prompt).toContain('Text regions: x=0.100 y=0.200');
    expect(images.requests[0]?.prompt).toContain('protection=none');
    expect(images.requests[0]?.prompt).toContain('#FFFFFF');
    expect(images.requests[0]?.prompt).toContain('crop left=0.200');
    expect(images.requests[2]?.prompt).toContain('protection=solid');
  });

  it('keeps the frame in the checkpoint key across a resume', async () => {
    const directory = await mkdtemp(`${tmpdir()}/illustration-frame-`);
    try {
      const prompts: unknown[] = [];
      const firstImages = new FakeImageProvider();
      const checkpoints = new TaskCheckpoints(directory, 'illustration-spec');
      const first = await SharedIllustrations.load(
        {
          images: firstImages,
          text: text(prompts),
          designSystem,
          seed: 7,
          signal: AbortSignal.timeout(5000),
          checkpoints,
        },
        registryDir,
      );
      await first.request({ ...slide, frame });
      expect(firstImages.requests).toHaveLength(1);
      const resumedImages = new FakeImageProvider();
      const resumed = await SharedIllustrations.load(
        {
          images: resumedImages,
          text: text([]),
          designSystem,
          seed: 7,
          signal: AbortSignal.timeout(5000),
          checkpoints: new TaskCheckpoints(directory, 'illustration-spec'),
        },
        registryDir,
      );
      const picture = await resumed.request({ ...slide, frame });
      expect(resumedImages.requests).toHaveLength(0);
      expect(picture?.prompt).toContain('Text regions:');
      await resumed.request({
        ...slide,
        frame: { ...frame, textRegions: [{ ...region, protection: 'unknown' }] },
      });
      expect(resumedImages.requests).toHaveLength(1);
      expect(resumedImages.requests[0]?.prompt).toContain('protection=unknown');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('gives null for a picture the server did not draw, so the slide goes without it', async () => {
    const images = {
      model: 'broken',
      generate: async () => {
        throw new Error('Image API responded 500.');
      },
    };
    const shared = await SharedIllustrations.load(
      { images, text: text([]), designSystem, seed: 1, signal: AbortSignal.timeout(5000) },
      registryDir,
    );
    expect(await shared.request(slide)).toBeNull();
    expect(shared.failures).toEqual([
      { key: expect.stringMatching(/^[a-f0-9]{64}$/), message: 'Image API responded 500.' },
    ]);
  });
});
