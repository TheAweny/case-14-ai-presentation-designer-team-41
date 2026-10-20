import { z } from 'zod';
import { brandbookProfileSchema, type BrandbookProfile } from '@lct/contracts';

/** Formats that the brandbook parser can inspect. This picker is intentionally separate from materials. */
export const BRANDBOOK_FILE_ACCEPT =
  '.fig,.rar,.zip,.pdf,.json,.svg,.png,.jpg,.jpeg,.webp,.ttf,.otf,.woff,.woff2,.pptx,.potx';

/** The upload endpoint must return a parsed profile; a generic material upload is not a brandbook. */
export const brandbookUploadSchema = z.object({
  fileId: z.string().uuid(),
  kind: z.literal('brandbook'),
  fileName: z.string().min(1).max(300),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  profile: brandbookProfileSchema,
  mine: z.boolean().optional(),
  shared: z.boolean().optional(),
});
export type BrandbookUpload = z.infer<typeof brandbookUploadSchema>;

/** Parse and validate the profile returned by a trusted API response. */
export function parseBrandbookUpload(value: unknown): BrandbookUpload {
  return brandbookUploadSchema.parse(value);
}

/** Browser must request previews through the authenticated backend proxy. */
export function brandbookAssetUrl(brandbookId: string, assetId: string): string {
  return `/api/backend/files/brandbooks/${encodeURIComponent(brandbookId)}/assets/${encodeURIComponent(assetId)}`;
}

/** Never put uploaded SVG/HTML into an img or iframe without sanitisation. */
export function canPreviewBrandbookAsset(mediaType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mediaType.toLowerCase());
}

export interface BrandbookSummary {
  readonly fileId: string;
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly profile: BrandbookProfile;
  readonly mine?: boolean;
  readonly shared?: boolean;
}

export function brandbookSummary(upload: BrandbookUpload): BrandbookSummary {
  return upload;
}
