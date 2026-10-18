import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { illustrationPromptSchema, type DesignSystem, type ImageSlot } from '@lct/contracts';
import { loadAgent, type LoadedAgent } from '@lct/registry';
import type { ImageProvider, ImageSize } from './images.js';
import { sizeFor } from './images.js';
import { OpenAICompatibleProvider, RoutedTextProvider, type TextProvider } from './provider.js';

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
    if (deps.text instanceof OpenAICompatibleProvider || deps.text instanceof RoutedTextProvider)
      deps.text.setAgentGeneration('illustrator', agent.config.generation);
    return new SharedIllustrations({ ...deps, instructions: agent.instructions }, agent);
  }

  get model(): string {
    return this.deps.images.model;
  }

  request(request: IllustrationRequest): Promise<Illustration | null> {
    const size = sizeFor(request.box);
    const key = `${request.index}:${request.ordinal}:${size}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.draw(request, size).catch((error: unknown) => {
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

  private async draw(request: IllustrationRequest, size: ImageSize): Promise<Illustration> {
    const { prompt } = await this.deps.text.generate(
      'illustrator',
      this.deps.instructions,
      {
        imageQuery: request.imageQuery,
        slideClaim: request.purpose,
        deck: request.deck,
        picture: { ordinal: request.ordinal + 1, of: request.count, shape: shapeOf(size) },
        style: styleOf(this.deps.designSystem),
      },
      illustrationPromptSchema,
      this.deps.signal,
    );
    // One seed per slot, from the run's seed, so a rerun of the brief draws the same pictures.
    const seed = (this.deps.seed * 1000 + request.index * 10 + request.ordinal) % 2 ** 31;
    const image = await this.deps.images.generate({ prompt, size, seed }, this.deps.signal);
    return { ...image, prompt, seed, size, model: this.deps.images.model };
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
