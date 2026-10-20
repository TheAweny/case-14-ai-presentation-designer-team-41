import {
  brandbookParseRequestSchema,
  brandbookProfileSchema,
  brandbookTemplateRequestSchema,
  brandbookTemplateResponseSchema,
  type BrandbookParseRequest,
  type BrandbookProfile,
  type BrandbookTemplateRequest,
  type BrandbookTemplateResponse,
} from '@lct/contracts';
import { compositionCheckResponseSchema, type CompositionCheckResponse } from '@lct/contracts';
import {
  datasetExtractRequestSchema,
  datasetSchema,
  type Dataset,
  type DatasetExtractRequest,
} from '@lct/contracts';
import {
  generationProfileSchema,
  compositionExportResponseSchema,
  type GenerationProfile,
  type CompositionExportRequest,
  type CompositionExportResponse,
} from '@lct/contracts';
import {
  auditReportSchema,
  deckExportResponseSchema,
  deckImportResponseSchema,
  templatePreviewsResponseSchema,
  editableDeckResponseSchema,
  healthCheckSchema,
  layoutVariantsResponseSchema,
  materialExtractRequestSchema,
  materialExtractResponseSchema,
  type AuditReport,
  type AuditRequest,
  type DeckExportRequest,
  type DeckExportResponse,
  type DeckImportRequest,
  type TemplatePreviewsRequest,
  type TemplatePreviewsResponse,
  type DeckImportResponse,
  type EditableDeckRequest,
  type EditableDeckResponse,
  type HealthCheck,
  type LayoutVariantsRequest,
  type LayoutVariantsResponse,
  type MaterialExtractRequest,
  type MaterialExtractResponse,
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

  /** `POST /v1/generation-profile` — exact reusable compositions before a run. */
  async generationProfile(templatePath: string): Promise<GenerationProfile> {
    return generationProfileSchema.parse(
      await this.post('/v1/generation-profile', { template_path: templatePath }),
    );
  }

  /** `POST /v1/composition-decks` — one template-faithful editable export of a deck. */
  async exportCompositions(
    request: CompositionExportRequest,
    signal?: AbortSignal,
  ): Promise<CompositionExportResponse> {
    return compositionExportResponseSchema.parse(
      await this.post('/v1/composition-decks', request, signal),
    );
  }

  /** `POST /v1/composition-check` — typography overflow check of slot bindings. */
  async checkCompositions(
    request: CompositionExportRequest,
    signal?: AbortSignal,
  ): Promise<CompositionCheckResponse> {
    return compositionCheckResponseSchema.parse(
      await this.post('/v1/composition-check', request, signal),
    );
  }

  /** `POST /v1/layouts` — one plan laid out as the requested variants on a template. */
  /** `POST /v1/composition-audit` — the deterministic audit of an exported composition deck. */
  async auditCompositions(
    request: CompositionExportRequest,
    signal?: AbortSignal,
  ): Promise<AuditReport> {
    return auditReportSchema.parse(await this.post('/v1/composition-audit', request, signal));
  }

  async layouts(request: LayoutVariantsRequest): Promise<LayoutVariantsResponse> {
    return layoutVariantsResponseSchema.parse(await this.post('/v1/layouts', request));
  }

  /** `POST /v1/audit` — the deterministic audit of a deck against its template. */
  async audit(request: AuditRequest): Promise<AuditReport> {
    return auditReportSchema.parse(await this.post('/v1/audit', request));
  }

  /** `POST /v1/exports` — one variant written as native PPTX, and PDF from it. */
  async exportDeck(request: DeckExportRequest): Promise<DeckExportResponse> {
    return deckExportResponseSchema.parse(await this.post('/v1/exports', request));
  }

  /**
   * `POST /v1/deck-import` — a finished .pptx read back as SlideIR, the way its slides are drawn,
   * with the pictures they reference written into `mediaDir`.
   */
  async importDeck(request: DeckImportRequest, signal?: AbortSignal): Promise<DeckImportResponse> {
    return deckImportResponseSchema.parse(await this.post('/v1/deck-import', request, signal));
  }

  /**
   * `POST /v1/template-previews` — every slide of a saved template drawn as a PNG, for the library
   * to show its sample slides as they are. Takes about a minute for a large template.
   */
  async templatePreviews(
    request: TemplatePreviewsRequest,
    signal?: AbortSignal,
  ): Promise<TemplatePreviewsResponse> {
    return templatePreviewsResponseSchema.parse(
      await this.post('/v1/template-previews', request, signal),
    );
  }

  /**
   * `POST /v1/material-extract` — a slice of an uploaded text or spreadsheet file.
   * Omitted `offset` and `limit` are sent as the contract defaults, 0 and 20.
   */
  async extractMaterial(
    request: Omit<MaterialExtractRequest, 'offset' | 'limit'> &
      Partial<Pick<MaterialExtractRequest, 'offset' | 'limit'>>,
    signal?: AbortSignal,
  ): Promise<MaterialExtractResponse> {
    const body = materialExtractRequestSchema.parse(request);
    return materialExtractResponseSchema.parse(
      await this.post('/v1/material-extract', body, signal),
    );
  }

  /** Every table of a data file, typed and unabridged; a file that holds none says why. */
  async extractDataset(request: DatasetExtractRequest, signal?: AbortSignal): Promise<Dataset> {
    const body = datasetExtractRequestSchema.parse(request);
    return datasetSchema.parse(await this.post('/v1/dataset-extract', body, signal));
  }

  async parseBrandbook(request: BrandbookParseRequest): Promise<BrandbookProfile> {
    return brandbookProfileSchema.parse(
      await this.post('/v1/brandbook-profile', brandbookParseRequestSchema.parse(request)),
    );
  }

  async prepareBrandbookTemplate(
    request: BrandbookTemplateRequest,
  ): Promise<BrandbookTemplateResponse> {
    return brandbookTemplateResponseSchema.parse(
      await this.post('/v1/brandbook-template', brandbookTemplateRequestSchema.parse(request)),
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
