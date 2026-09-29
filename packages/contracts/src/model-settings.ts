import { z } from 'zod';

/**
 * Model settings: connections to OpenAI-compatible servers and which model performs each role of
 * the pipeline. The web edits them, the API stores them and builds providers from them.
 *
 * The key crosses this contract in one direction only. It arrives in `connectionInputSchema` and
 * `probeInputSchema`; nothing that goes back out carries it. A connection as anyone outside the
 * API sees it states whether a key is set and its last characters (`hasKey`, `keyHint`), so there
 * is no field a key could be returned through, even by mistake.
 *
 * Not part of `contractRegistry`: the engine never calls a model, so Python has no use for it.
 */

/**
 * Roles of the pipeline from `docs/MODELS.md`, in the order they work on a deck: the assistant
 * talks to the person in the chat, the rest build the deck.
 */
export const PIPELINE_ROLES = [
  'assistant',
  'planner',
  'writer',
  'critic',
  'vision',
  'image',
] as const;
export const pipelineRoleSchema = z.enum(PIPELINE_ROLES);
export type PipelineRole = z.infer<typeof pipelineRoleSchema>;

/**
 * Whether a role can be switched off. A deck is built without the illustrator: pictures come
 * from the content pack or are not drawn. Without a plan, copy, audit or visual review it is not.
 * The assistant without a model of its own talks with the writer's.
 */
export function isRoleOptional(role: PipelineRole): boolean {
  return role === 'image' || role === 'assistant';
}

/**
 * Where a connection was started from. A preset only fills in the address and the name; after
 * that it is an ordinary OpenAI-compatible server.
 */
export const CONNECTION_PRESETS = ['ollama', 'lm-studio', 'vllm', 'custom'] as const;
export const connectionPresetSchema = z.enum(CONNECTION_PRESETS);
export type ConnectionPreset = z.infer<typeof connectionPresetSchema>;

/**
 * Id of the connection the server is configured with (`LLM_BASE_URL`, `LLM_MODEL`,
 * `MODEL_API_KEY`). It is read-only: its key lives in the environment and cannot be edited or
 * removed from the interface.
 */
export const SERVER_CONNECTION_ID = 'server';

export const CONNECTION_NAME_MAX_LENGTH = 60;
export const BASE_URL_MAX_LENGTH = 2048;
export const API_KEY_MAX_LENGTH = 512;
export const MODEL_ID_MAX_LENGTH = 256;
/** How long a check waits for a server. A local one answers at once, a cloud one within a second. */
export const MODEL_CHECK_TIMEOUT_MS = 5000;
/** How many models of a server's answer are kept: a role menu cannot offer more anyway. */
export const MODEL_LIST_MAX_LENGTH = 500;

/**
 * Why a check failed. Each kind is fixed differently: unreachable — start the server or fix the
 * address, 401/403 — the key, another format — the address is not an OpenAI-compatible API,
 * `blocked` — the address is inside a private network and such addresses are not allowed.
 */
export const checkErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unreachable'), detail: z.string().max(200).nullable() }),
  z.object({ kind: z.literal('unauthorized'), status: z.number().int() }),
  z.object({ kind: z.literal('http'), status: z.number().int() }),
  z.object({ kind: z.literal('invalid-response') }),
  z.object({ kind: z.literal('timeout') }),
  z.object({ kind: z.literal('blocked') }),
]);
export type CheckError = z.infer<typeof checkErrorSchema>;

export const modelIdSchema = z.string().trim().min(1).max(MODEL_ID_MAX_LENGTH);

/** Outcome of the last check: when, and either the models found or why it failed. */
export const connectionCheckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    at: z.iso.datetime(),
    models: z.array(modelIdSchema).max(MODEL_LIST_MAX_LENGTH),
  }),
  z.object({ ok: z.literal(false), at: z.iso.datetime(), error: checkErrorSchema }),
]);
export type ConnectionCheck = z.infer<typeof connectionCheckSchema>;

/** A connection as the browser sees it: no key, only whether one is set and its last characters. */
export const modelConnectionSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string(),
  preset: connectionPresetSchema,
  baseUrl: z.string(),
  hasKey: z.boolean(),
  /** Last characters of the key, to tell one key from another; null for a short key. */
  keyHint: z.string().nullable(),
  /** Null: the connection has not been checked yet. */
  lastCheck: connectionCheckSchema.nullable(),
  /**
   * Models this connection offers. Null or missing: any model, the whole list the check reported
   * and ids typed by hand. A list offers only those ids, so a shared gateway can offer one model
   * instead of hundreds; for a shared key it applies to every account.
   */
  enabledModels: z.array(modelIdSchema).max(MODEL_LIST_MAX_LENGTH).nullable().optional(),
  /** Configured on the server through the environment: it can be checked, not edited. */
  managed: z.boolean(),
  /**
   * Shared with every account by an administrator. Everyone can pick its models; only an
   * administrator changes it, and nobody else sees its key hint.
   */
  shared: z.boolean().optional(),
  /** The account asking may edit and delete it. */
  editable: z.boolean().optional(),
});
export type ModelConnection = z.infer<typeof modelConnectionSchema>;

/** Who performs a role: a model on a connection, nobody (optional roles only) or not yet set. */
export const roleAssignmentSchema = z.discriminatedUnion('kind', [
  z.object({
    role: pipelineRoleSchema,
    kind: z.literal('model'),
    connectionId: z.string().min(1),
    modelId: modelIdSchema,
  }),
  z.object({ role: pipelineRoleSchema, kind: z.literal('disabled') }),
  z.object({ role: pipelineRoleSchema, kind: z.literal('unassigned') }),
]);
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

/** A model on a connection: how a run names the model it should use. */
export const modelRefSchema = z.object({
  connectionId: z.string().min(1).max(200),
  modelId: modelIdSchema,
});
export type ModelRef = z.infer<typeof modelRefSchema>;

/** All model settings. `roles` holds every role exactly once, in `PIPELINE_ROLES` order. */
export const modelSettingsSchema = z.object({
  connections: z.array(modelConnectionSchema),
  roles: z.array(roleAssignmentSchema),
  /**
   * Roles whose model comes from the defaults for everyone (set by an administrator, or the
   * server connection) rather than the account's own choice.
   */
  inheritedRoles: z.array(pipelineRoleSchema).optional(),
  /**
   * The account asking is an administrator: its connections may be shared, and its role choices
   * are the defaults for everyone.
   */
  managesShared: z.boolean().optional(),
});
export type ModelSettings = z.infer<typeof modelSettingsSchema>;

/**
 * What was typed into the connection form. Without `connectionId` it is a new connection, with it
 * an edit. An empty `apiKey` on an edit keeps the stored key: the key field is always empty,
 * because the key never comes back to the browser.
 *
 * `lastCheck` is the check the form ran right before saving, for the same address and key.
 */
export const connectionInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  name: z.string().max(CONNECTION_NAME_MAX_LENGTH * 4),
  preset: connectionPresetSchema,
  baseUrl: z.string().max(BASE_URL_MAX_LENGTH * 2),
  apiKey: z
    .string()
    .max(API_KEY_MAX_LENGTH * 2)
    .optional(),
  lastCheck: connectionCheckSchema.nullable().optional(),
  /** Share with every account; only an administrator's request may set it. */
  shared: z.boolean().optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

/** A check of a connection not saved yet. With `connectionId` and no key the stored key is used. */
export const probeInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  baseUrl: z.string().max(BASE_URL_MAX_LENGTH * 2),
  apiKey: z
    .string()
    .max(API_KEY_MAX_LENGTH * 2)
    .optional(),
});
export type ProbeInput = z.infer<typeof probeInputSchema>;

/**
 * Which models of one connection stay available. `null` lifts the limit, an empty list switches
 * every model off. Only whoever may edit the connection can send this — for a shared connection
 * and the one from the server environment that is an administrator; everyone else just sees the
 * shorter list.
 */
export const connectionModelsInputSchema = z.object({
  connectionId: z.string().min(1),
  enabledModels: z.array(modelIdSchema).max(MODEL_LIST_MAX_LENGTH).nullable(),
});
export type ConnectionModelsInput = z.infer<typeof connectionModelsInputSchema>;

// Input checks. Each returns a reason, not a text: the words live in the interface dictionary.

export type ConnectionNameProblem = 'empty' | 'tooLong';

export function connectionNameProblem(name: string): ConnectionNameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > CONNECTION_NAME_MAX_LENGTH) return 'tooLong';
  return null;
}

/**
 * `credentials` is a login and password inside the address (`https://user:pass@host`): everyone
 * who sees the address would see them, and a key belongs in the key field.
 */
export type BaseUrlProblem = 'empty' | 'tooLong' | 'invalid' | 'protocol' | 'credentials';

export function baseUrlProblem(value: string): BaseUrlProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > BASE_URL_MAX_LENGTH) return 'tooLong';
  // "localhost:11434/v1" without a scheme is the most common slip: name the scheme, not "invalid".
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return 'protocol';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'protocol';
  if (url.hostname === '') return 'invalid';
  if (url.username !== '' || url.password !== '') return 'credentials';
  return null;
}

/** `whitespace`: a space or line break inside the key, which is how a sloppy copy looks. */
export type ApiKeyProblem = 'tooLong' | 'whitespace';

export function apiKeyProblem(key: string): ApiKeyProblem | null {
  const trimmed = key.trim();
  if (trimmed.length > API_KEY_MAX_LENGTH) return 'tooLong';
  if (/\s/.test(trimmed)) return 'whitespace';
  return null;
}

export interface ConnectionProblems {
  readonly name?: ConnectionNameProblem;
  readonly baseUrl?: BaseUrlProblem;
  readonly apiKey?: ApiKeyProblem;
}

/** Every problem of the form at once: an empty object means it can be saved. */
export function connectionInputProblems(input: {
  name: string;
  baseUrl: string;
  apiKey?: string;
}): ConnectionProblems {
  const name = connectionNameProblem(input.name);
  const baseUrl = baseUrlProblem(input.baseUrl);
  const apiKey = input.apiKey === undefined ? null : apiKeyProblem(input.apiKey);
  return {
    ...(name ? { name } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function hasProblems(problems: ConnectionProblems): boolean {
  return Object.keys(problems).length > 0;
}

/**
 * An address as it is stored: trimmed and without trailing `/`. `/models` is appended to it, and a
 * double slash breaks some servers.
 */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** The model list of an OpenAI-compatible server. */
export function modelsEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

/** Below this length not even part of a key is shown: four characters would be a large share. */
const KEY_HINT_MIN_LENGTH = 12;
const KEY_HINT_LENGTH = 4;

/**
 * What the browser may learn about a key: its last four characters, as cloud consoles show them.
 * A short key gets nothing, only the fact that one is set.
 */
export function keyHint(key: string | null): string | null {
  if (key === null) return null;
  const trimmed = key.trim();
  if (trimmed.length < KEY_HINT_MIN_LENGTH) return null;
  return trimmed.slice(-KEY_HINT_LENGTH);
}

/**
 * Why the API refused a settings request, in a shape the web turns back into its own errors:
 * `notFound` — no such connection, `invalid` — the input, with problems per field when that is
 * the cause, `managed` — the connection comes from the server environment and is read-only,
 * `unavailable` — stored keys cannot be encrypted because `MODEL_KEYS_SECRET` is not set.
 */
export const modelSettingsErrorSchema = z.object({
  reason: z.enum(['notFound', 'invalid', 'managed', 'unavailable']),
  problems: z
    .object({
      name: z.enum(['empty', 'tooLong']).optional(),
      baseUrl: z.enum(['empty', 'tooLong', 'invalid', 'protocol', 'credentials']).optional(),
      apiKey: z.enum(['tooLong', 'whitespace']).optional(),
    })
    .default({}),
});
export type ModelSettingsError = z.infer<typeof modelSettingsErrorSchema>;
