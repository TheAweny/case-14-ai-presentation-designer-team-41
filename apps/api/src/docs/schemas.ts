import { z } from 'zod';
import { RUN_STATES, type RunRecord } from '@lct/run-store';
import type { ValidatedLocalInputs } from '@lct/input-validation';
import {
  designSystemSchema,
  layoutVariantSchema,
  modelRefSchema,
  slideIrSchema,
  templateIrSchema,
} from '@lct/contracts';
import { ACCOUNT_ROLES, type Account } from '../accounts/account-rules.js';
import type { StoredFile } from '../files/files.controller.js';
import type { TemplatePreparation } from '../generation/generation.controller.js';

/**
 * Shapes of API requests and answers that have no contract in `@lct/contracts`: they are the
 * API's own and never reach the engine. They exist for the OpenAPI document only; routes check
 * their bodies themselves. Answers are tied to the types the routes return, so a field added to
 * a route and forgotten here fails `typecheck`.
 */

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const accountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ACCOUNT_ROLES),
  disabled: z.boolean(),
  createdAt: z.string(),
  avatar: z
    .string()
    .nullable()
    .optional()
    .describe('null — знак по id, `preset:N` — выбранный знак, иначе data URL картинки.'),
});
const accountMatches: Same<z.infer<typeof accountSchema>, Account> = true;

export const storedFileSchema = z.object({
  fileId: z.string().uuid(),
  kind: z.enum(['template', 'content', 'artifact']),
  fileName: z.string().optional(),
  size: z.number().int().optional(),
  sha256: z.string().optional(),
  profile: z.unknown().optional().describe('Профиль шаблона, который вернул движок.'),
  name: z.string().optional().describe('Имя шаблона в библиотеке.'),
  shared: z.boolean().optional().describe('Шаблон открыт всем аккаунтам.'),
  mine: z.boolean().optional().describe('Шаблон загрузил этот аккаунт.'),
  createdAt: z.string().optional(),
});
const storedFileMatches: Same<z.infer<typeof storedFileSchema>, StoredFile> = true;

export const runRecordSchema = z.object({
  runId: z.string(),
  state: z.enum(RUN_STATES),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
const runRecordMatches: Same<z.infer<typeof runRecordSchema>, RunRecord> = true;

const localInputFileSchema = z.object({ path: z.string(), sha256: z.string(), bytes: z.number() });
export const validatedInputsSchema = z.object({
  template: localInputFileSchema,
  content: localInputFileSchema,
  outputDir: z.string(),
});
const validatedInputsMatches: Same<
  z.infer<typeof validatedInputsSchema>,
  ValidatedLocalInputs
> = true;

export const templatePreparationSchema = z.object({
  readiness: z
    .object({
      index: z.enum(['missing', 'partial', 'stale', 'ready']),
      geometry: z.boolean(),
      fonts: z.literal('unknown'),
      compositions: z.number(),
      textSlots: z.number(),
      imageSlots: z.number(),
    })
    .optional(),
  stage: z.enum(['profile', 'index']).nullable().describe('Идущий этап; null — подготовки нет.'),
  described: z.number().int(),
  total: z.number().int(),
  indexed: z.boolean(),
  drawing: z.boolean(),
  drawn: z.boolean(),
});
const preparationMatches: Same<
  z.infer<typeof templatePreparationSchema>,
  TemplatePreparation
> = true;

export const startedBuildSchema = runRecordSchema.extend({
  variants: z.array(z.object({ variant: layoutVariantSchema, runId: z.string() })),
});

/** `deck.json` of a finished run, as the pipeline writes it. */
export const deckSummarySchema = z.object({
  runId: z.string(),
  variant: layoutVariantSchema,
  title: z.string(),
  designSystem: designSystemSchema,
  templateIr: templateIrSchema,
  warnings: z.array(z.unknown()),
  imagesMocked: z.boolean(),
});

export const libraryDeckSchema = z.object({
  deck: deckSummarySchema,
  metadata: z.object({
    templateId: z.string(),
    projectId: z.string().nullable(),
    ownerId: z.string().optional(),
    chatId: z.string().nullable(),
    variant: z.string().optional(),
    buildId: z.string().optional(),
    updatedAt: z.number(),
    title: z.string().optional(),
    variants: z.array(z.string()).describe('Все готовые варианты сборки.'),
  }),
});

export const projectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string(),
  appearance: z.object({ icon: z.string(), color: z.string() }),
  createdAt: z.string(),
  updatedAt: z.string(),
  pinnedAt: z.string().nullable(),
});

export const listedProjectSchema = projectSchema.extend({
  templateIds: z.array(z.string()),
  deckCount: z.number().int().describe('Сборки проекта: три варианта считаются одной колодой.'),
});

export const exportedDeckSchema = z.object({
  exportId: z.string().uuid(),
  previews: z.array(z.string()).describe('Имена превью, если просили PNG или HTML.'),
});

export const okSchema = z.object({ ok: z.literal(true) });

// Request bodies the routes read by hand.

export const credentialsSchema = z.object({ email: z.string(), password: z.string() });

export const prepareRequestSchema = z.object({
  templateId: z.string().uuid(),
  model: modelRefSchema.nullable().optional().describe('Модель описания макетов; null — роль.'),
});

export const exportRequestSchema = z.object({
  slides: z.array(slideIrSchema).min(1).describe('Слайды, как они сейчас в редакторе.'),
  variant: layoutVariantSchema.optional(),
  format: z.enum(['pptx', 'pdf', 'png', 'html']).optional(),
  media: z
    .array(
      z
        .object({
          mediaPart: z.string().regex(/^upload\/[\w.-]+\.(png|jpe?g)$/),
          dataUrl: z.string().max(1398136),
        })
        .strict(),
    )
    .max(32)
    .optional()
    .describe(
      'PNG/JPEG загруженных изображений, на которые ссылаются слайды; до 1 МиБ каждое и 3 МиБ всего.',
    ),
});

export const deckPatchSchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().nullable().optional().describe('null — вынести из проекта.'),
});

export const templatePatchSchema = z.object({
  name: z.string().max(200).optional(),
  shared: z.boolean().optional().describe('Открыть шаблон всем; только администратор.'),
});

export const projectInputSchema = z.object({
  name: z.string().optional(),
  appearance: z.object({ icon: z.string(), color: z.string() }).optional(),
  pinned: z.boolean().optional(),
});

export const chatPatchSchema = z.object({
  title: z.string().optional(),
  projectId: z.string().nullable().optional().describe('null — вынести из проекта.'),
  deckId: z.string().optional().describe('Вариант сборки, к которому ведёт чат.'),
});

export const retryVariantSchema = z.object({ buildId: z.string(), variant: layoutVariantSchema });

export const profilePatchSchema = z.object({
  name: z.string().optional(),
  avatar: z.string().nullable().optional(),
  currentPassword: z.string().optional().describe('Нужен, если меняется пароль.'),
  password: z.string().optional(),
});

export const accountInputSchema = z.object({
  email: z.string(),
  name: z.string(),
  password: z.string(),
  role: z.enum(ACCOUNT_ROLES).optional(),
});

export const accountPatchSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  password: z.string().optional(),
  role: z.enum(ACCOUNT_ROLES).optional(),
  disabled: z.boolean().optional(),
  avatar: z.string().nullable().optional(),
});

/** What Nest answers on an error it threw. */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});

void [
  accountMatches,
  storedFileMatches,
  runRecordMatches,
  validatedInputsMatches,
  preparationMatches,
];
