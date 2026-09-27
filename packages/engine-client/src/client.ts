import { compositionCheckResponseSchema, type CompositionCheckResponse } from '@lct/contracts';
import {
  generationProfileSchema,
  compositionExportResponseSchema,
  type GenerationProfile,
  type CompositionExportRequest,
  type CompositionExportResponse,
} from '@lct/contracts';
import {
  editableDeckResponseSchema,
  healthCheckSchema,
  type EditableDeckRequest,
  type EditableDeckResponse,
  type HealthCheck,
} from '@lct/contracts';

export interface EngineClientOptions {
  /** Base URL of the engine, e.g. http://engine:8000 */
  readonly baseUrl: string;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Injectable fetch, so tests do not need a running engine. */
  readonly fetchImpl?: typeof fetch;
}

export interface TemplateProfileResponse {
  readonly designSystem: unknown;
  readonly templateIr: unknown;
}

/** Raised when the engine answers with a non-2xx status. */
export class EngineHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Engine responded ${status} for ${path}: ${body}`);
    this.name = 'EngineHttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class EngineClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EngineClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** `GET /health` — liveness of the engine, validated against the shared contract. */
  async health(): Promise<HealthCheck> {
    return healthCheckSchema.parse(await this.get('/health'));
  }

  /** `POST /v1/editable-decks` — build and validate one native editable PPTX. */
  async createEditableDeck(request: EditableDeckRequest): Promise<EditableDeckResponse> {
    return editableDeckResponseSchema.parse(await this.post('/v1/editable-decks', request));
  }

  /** `POST /v1/template-profile` — parse a saved PPTX without generating a deck. */
  async parseTemplateProfile(templatePath: string): Promise<TemplateProfileResponse> {
    const response = await this.post('/v1/template-profile', { template_path: templatePath });
    if (typeof response !== 'object' || response === null) {
      throw new Error('Engine returned an invalid template profile.');
    }
    return response as TemplateProfileResponse;
  }

  async generationProfile(templatePath: string): Promise<GenerationProfile> {
    return generationProfileSchema.parse(
      await this.post('/v1/generation-profile', { template_path: templatePath }),
    );
  }

  async exportCompositions(
    request: CompositionExportRequest,
    signal?: AbortSignal,
  ): Promise<CompositionExportResponse> {
    return compositionExportResponseSchema.parse(
      await this.post('/v1/composition-decks', request, signal),
    );
  }

  async checkCompositions(
    request: CompositionExportRequest,
    signal?: AbortSignal,
  ): Promise<CompositionCheckResponse> {
    return compositionCheckResponseSchema.parse(
      await this.post('/v1/composition-check', request, signal),
    );
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new EngineHttpError(response.status, path, await response.text());
    }
    return response.json();
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new EngineHttpError(response.status, path, await response.text());
    }
    return response.json();
  }
}
