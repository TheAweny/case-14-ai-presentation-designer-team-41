import { z } from 'zod';

/**
 * Claim — one fact a writer may cite by id.
 *
 * The same weights write the deck and criticise it, so one model agreeing with the other is not
 * evidence. A user claim quotes the person's material or their answer. A web claim points at an
 * external URL and is not usable for a figure until a person sets `accepted`. An assumption is a
 * process, a risk, or a criterion and contains no digit. A contradiction or an insufficient record
 * cannot support a number or a name.
 *
 * A grounded claim keeps a stable `claimId`, a statement, a `sourceId`, an exact quote, and a
 * locator (a page or a URL), plus an optional unit, period, and scope. Scope is the object the
 * figure is about. The numeric `value` is its own field: a digit that merely occurs in a document
 * is not that field.
 *
 * Model-only, like CompositionPlan. Not part of `contractRegistry`, and not generated into Python.
 */

export const CLAIM_STATUSES = [
  'user',
  'web',
  'assumption',
  'contradiction',
  'insufficient',
] as const;
export const claimStatusSchema = z.enum(CLAIM_STATUSES);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const ASSUMPTION_KINDS = ['process', 'risk', 'criterion'] as const;
export const assumptionKindSchema = z.enum(ASSUMPTION_KINDS);
export type AssumptionKind = z.infer<typeof assumptionKindSchema>;

/** Any numeric digit. An assumption never states a figure, in any script. */
const DIGIT = /\p{Nd}/u;

const claimIdSchema = z
  .string()
  .min(1)
  .describe('Stable id a writer cites. The same id is the same claim for every variant.');

const statementSchema = z.string().min(1).describe('What the claim says.');

const sourceIdSchema = z
  .string()
  .min(1)
  .describe("The person's material, or their answer, that the quote was copied from.");

const quoteSchema = z
  .string()
  .min(1)
  .describe('Copied verbatim. It counts only as an exact, non-empty substring of that source.');

const claimValueSchema = z
  .number()
  .refine((value) => Number.isFinite(value), 'A claim value is a finite number.')
  .optional()
  .describe('The figure this claim asserts. A digit inside the quote is not this field.');

const unitSchema = z.string().min(1).optional().describe('Unit of the figure, when it has one.');
const periodSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Period the figure belongs to, when it has one.');
const scopeSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Object the figure is about, when the claim names one.');

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const pageLocatorSchema = z.object({
  page: z.number().int().positive().describe("Page of the person's material the quote is on."),
});

const urlLocatorSchema = z.object({
  url: z
    .string()
    .min(1)
    .refine(isHttpUrl, 'A locator url is an http(s) address.')
    .describe('http(s) address of the passage.'),
});

/** Where the quote sits: a page of the person's material, or an http(s) URL. */
export const claimLocatorSchema = z.union([pageLocatorSchema, urlLocatorSchema]);
export type ClaimLocator = z.infer<typeof claimLocatorSchema>;

const schemaVersionSchema = z.literal(1).describe('Incremented by any incompatible change.');

const userClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  status: z.literal('user'),
  claimId: claimIdSchema,
  statement: statementSchema,
  sourceId: sourceIdSchema,
  quote: quoteSchema,
  locator: claimLocatorSchema,
  value: claimValueSchema,
  unit: unitSchema,
  period: periodSchema,
  scope: scopeSchema,
});

const webClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  status: z.literal('web'),
  claimId: claimIdSchema,
  statement: statementSchema,
  sourceId: sourceIdSchema,
  quote: quoteSchema,
  locator: urlLocatorSchema.describe('External source. A page number is not a URL.'),
  accepted: z
    .boolean()
    .describe(
      'True only after a person accepts this source. Until then it cannot ground a number.',
    ),
  value: claimValueSchema,
  unit: unitSchema,
  period: periodSchema,
  scope: scopeSchema,
});

const assumptionClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  status: z.literal('assumption'),
  claimId: claimIdSchema,
  statement: statementSchema.refine(
    (text) => !DIGIT.test(text),
    'An assumption must not contain a digit.',
  ),
  kind: assumptionKindSchema.describe('Process, risk, or criterion. Never a figure.'),
});

const contradictionClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  status: z.literal('contradiction'),
  claimId: claimIdSchema,
  statement: statementSchema.describe(
    'What conflicts. This record cannot support a number or a name.',
  ),
});

const insufficientClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  status: z.literal('insufficient'),
  claimId: claimIdSchema,
  statement: statementSchema.describe(
    'What is missing. This record cannot support a number or a name.',
  ),
});

export const claimSchema = z.discriminatedUnion('status', [
  userClaimSchema,
  webClaimSchema,
  assumptionClaimSchema,
  contradictionClaimSchema,
  insufficientClaimSchema,
]);
export type Claim = z.infer<typeof claimSchema>;

export const claimLedgerSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    claims: z.array(claimSchema),
  })
  .refine(
    (ledger) => new Set(ledger.claims.map((claim) => claim.claimId)).size === ledger.claims.length,
    'Claim ids must be unique.',
  );
export type ClaimLedger = z.infer<typeof claimLedgerSchema>;
