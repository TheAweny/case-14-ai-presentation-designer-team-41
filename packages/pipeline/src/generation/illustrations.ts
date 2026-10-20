import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  illustrationPromptSchema,
  type DesignSystem,
  type ImageFrameConstraint,
  type ImageSlot,
} from '@lct/contracts';
import { loadAgent, type LoadedAgent } from '@lct/registry';
import { z } from 'zod';
import type { ImageProvider, ImageSize } from './images.js';
import { sizeFor, IMAGE_SIZES } from './images.js';
import type { TextProvider } from './provider.js';
import { dependencyKey, type TaskCheckpoints } from './checkpoints.js';

/** A picture drawn for one slot of one planned slide, before it is written into a run. */
export interface Illustration {
  bytes: Buffer;
  extension: 'png' | 'jpg';
  prompt: string;
  seed: number;
  size: ImageSize;
  model: string;
}

/** What a slide asks a picture for: its place in the story and the plan's image query. */
export interface IllustrationRequest {
  /** Index of the planned slide; the three variants plan the same slides. */
  index: number;
  /** Which image slot of the slide, in reading order: a slide may frame several pictures. */
  ordinal: number;
  count: number;
  imageQuery: string;
  purpose: string;
  deck: { title: string; audience: string; goal: string };
  box: ImageSlot['box'];
  /**
   * Text sitting on the frame, the template crop and any plate already there.
   * Absent on a profile built before frames were measured.
   */
  frame?: ImageFrameConstraint | null;
}

/** Thousandths keep equal frames on one task when the parser rounds the same overlap twice. */
function share(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The part of a frame that changes the drawing. Slide position does not: two variants with the
 * same overlap, crop and protection share one picture.
 */
export function significantFrame(
  frame: ImageFrameConstraint | null | undefined,
): ImageFrameConstraint | null {
  if (!frame) return null;
  const textRegions = frame.textRegions
    .map((region) => ({
      x: share(region.x),
      y: share(region.y),
      width: share(region.width),
      height: share(region.height),
      protection: region.protection,
    }))
    .sort(
      (a, b) =>
        a.y - b.y ||
        a.x - b.x ||
        a.width - b.width ||
        a.height - b.height ||
        a.protection.localeCompare(b.protection),
    );
  return {
    textRegions,
    textColors: [...new Set(frame.textColors.map((color) => color.toUpperCase()))].sort(),
    crop: frame.crop
      ? {
          l: share(frame.crop.l),
          t: share(frame.crop.t),
          r: share(frame.crop.r),
          b: share(frame.crop.b),
        }
      : null,
    state: frame.state,
  };
}

/** English lines the image model sees even when the illustrator paraphrases the brief. */
export function frameDirective(frame: ImageFrameConstraint | null): string {
  if (!frame) return '';
  const regions = frame.textRegions
    .map(
      (region) =>
        `x=${region.x.toFixed(3)} y=${region.y.toFixed(3)} w=${region.width.toFixed(3)} h=${region.height.toFixed(3)} protection=${region.protection}`,
    )
    .join('; ');
  const crop = frame.crop
    ? `crop left=${frame.crop.l.toFixed(3)} top=${frame.crop.t.toFixed(3)} right=${frame.crop.r.toFixed(3)} bottom=${frame.crop.b.toFixed(3)}`
    : 'crop none';
  const colors = frame.textColors.length
    ? frame.textColors.map((color) => `#${color}`).join(', ')
    : 'none';
  return `Frame constraints: state=${frame.state}. Text regions: ${regions || 'none'}. Text colours: ${colors}. ${crop}.`;
}

/** Relative luminance of a hex colour, 0 for black and 1 for white. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The template's look as the illustrator reads it: its colours and whether its slides are dark. */
export function styleOf(designSystem: DesignSystem) {
  const colour = (role: string) =>
    designSystem.palette.find((entry) => entry.role === role)?.hex ?? null;
  const background = colour('background');
  return {
    accent: colour('accent'),
    background,
    text: colour('text'),
    palette: designSystem.palette.map((entry) => `${entry.role} #${entry.hex}`),
    tone: background && luminance(background) < 0.35 ? 'dark' : 'light',
  };
}

/** Wide, square or tall, as the illustrator names the shape of the slot. */
function shapeOf(size: ImageSize): 'wide' | 'square' | 'tall' {
  return size === '1536x1024' ? 'wide' : size === '1024x1536' ? 'tall' : 'square';
}

export interface IllustratorDependencies {
  checkpoints?: TaskCheckpoints;
  images: ImageProvider;
  text: TextProvider;
  instructions: string;
  designSystem: DesignSystem;
  seed: number;
  signal: AbortSignal;
}

/**
 * The pictures of one brief, drawn once and shared by its three variants, as `SharedPlan` shares
 * the plan. A variant asks for the picture of a slide's slot in the shape of its own box; the
 * variants that ask for the same slide, slot and shape get the one drawing. A picture that fails
 * resolves to null: the slide goes out without it, and the export removes the empty slot.
 */
export class SharedIllustrations {
  private readonly pending = new Map<string, Promise<Illustration | null>>();
  readonly failures: { key: string; message: string }[] = [];

  private constructor(
    private readonly deps: IllustratorDependencies,
    /** The illustrator agent, for the manifest of every variant that uses its pictures. */
    readonly agent: LoadedAgent,
  ) {}

  /** The pictures of one brief, with the illustrator agent read from the registry. */
  static async load(
    deps: Omit<IllustratorDependencies, 'instructions'>,
    registryDir: string,
  ): Promise<SharedIllustrations> {
    const agent = await loadAgent(join(registryDir, 'illustrator'));
    deps.text.setAgentGeneration?.('illustrator', agent.config.generation);
    return new SharedIllustrations({ ...deps, instructions: agent.instructions }, agent);
  }

  get model(): string {
    return this.deps.images.model;
  }

  request(request: IllustrationRequest): Promise<Illustration | null> {
    const size = sizeFor(request.box);
    const { box: _box, frame: _frame, ...content } = request;
    const frame = significantFrame(request.frame);
    const identity = {
      kind: 'illustration',
      content,
      frame,
      size,
      model: this.model,
      seed: this.deps.seed,
      instructions: this.deps.instructions,
      style: styleOf(this.deps.designSystem),
    };
    const key = dependencyKey(identity);
    let pending = this.pending.get(key);
    if (!pending) {
      const draw = async () => {
        const picture = await this.draw(request, size, frame);
        return { ...picture, bytes: picture.bytes.toString('base64') };
      };
      const saved = this.deps.checkpoints
        ? this.deps.checkpoints.once(
            identity,
            z.object({
              bytes: z.string().base64(),
              extension: z.enum(['png', 'jpg']),
              prompt: z.string(),
              seed: z.number(),
              size: z.enum(IMAGE_SIZES),
              model: z.string(),
            }),
            draw,
          )
        : draw();
      pending = saved
        .then((picture) => ({ ...picture, bytes: Buffer.from(picture.bytes, 'base64') }))
        .catch((error: unknown) => {
          this.failures.push({
            key,
            message: error instanceof Error ? error.message : 'Illustration failed.',
          });
          return null;
        });
      this.pending.set(key, pending);
    }
    return pending;
  }

  private async draw(
    request: IllustrationRequest,
    size: ImageSize,
    frame: ImageFrameConstraint | null,
  ): Promise<Illustration> {
    const directive = frameDirective(frame);
    const { prompt } = await this.deps.text.generate(
      'illustrator',
      this.deps.instructions,
      {
        imageQuery: request.imageQuery,
        slideClaim: request.purpose,
        deck: request.deck,
        picture: {
          ordinal: request.ordinal + 1,
          of: request.count,
          shape: shapeOf(size),
          frame,
        },
        style: styleOf(this.deps.designSystem),
      },
      illustrationPromptSchema,
      this.deps.signal,
    );
    // One seed per slot, from the run's seed, so a rerun of the brief draws the same pictures.
    const seed = (this.deps.seed * 1000 + request.index * 10 + request.ordinal) % 2 ** 31;
    const imagePrompt = directive ? `${prompt}\n${directive}` : prompt;
    const image = await this.deps.images.generate(
      { prompt: imagePrompt, size, seed },
      this.deps.signal,
    );
    return { ...image, prompt: imagePrompt, seed, size, model: this.deps.images.model };
  }
}

/** Writes a picture into a run's media directory and returns its path relative to the run. */
export async function saveIllustration(
  runDir: string,
  index: number,
  ordinal: number,
  picture: Illustration,
): Promise<string> {
  const name = `illustration-${index + 1}-${ordinal + 1}.${picture.extension}`;
  await mkdir(join(runDir, 'media'), { recursive: true });
  await writeFile(join(runDir, 'media', name), picture.bytes);
  return `media/${name}`;
}
