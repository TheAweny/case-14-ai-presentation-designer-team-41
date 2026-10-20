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

/**
 * Can the asset be shown through `<img>`? SVG is allowed: an image document runs no scripts, loads
 * no external resources and receives no events, so a hostile SVG can only draw itself. Opening the
 * asset URL directly would render it as a page, but the API serves every asset with
 * `Content-Disposition: attachment` and the proxy keeps that header, so the browser downloads it
 * instead. Never put uploaded SVG or HTML into an iframe, `<object>` or inline markup.
 */
export function canPreviewBrandbookAsset(mediaType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(
    mediaType.toLowerCase(),
  );
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

/** Брендбук библиотеки, как его показывают страница «Шаблоны» и поле генерации. */
export interface LibraryBrandbook {
  readonly brandbookId: string;
  /** Имя в библиотеке: исходное имя файла или то, на которое переименовали. */
  readonly name: string;
  readonly fileName: string;
  readonly size: number;
  readonly createdAt: number;
  readonly shared: boolean;
  readonly mine: boolean;
  readonly profile: BrandbookProfile;
}

const storedBrandbookSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  name: z.string().min(1).optional(),
  size: z.number().nonnegative(),
  createdAt: z.string().optional(),
  shared: z.boolean().optional(),
  mine: z.boolean().optional(),
  profile: brandbookProfileSchema,
});

/** Строка API → брендбук библиотеки; битая строка не роняет страницу, а пропускается. */
export function libraryBrandbookOf(row: unknown): LibraryBrandbook | null {
  const parsed = storedBrandbookSchema.safeParse(row);
  if (!parsed.success) return null;
  const value = parsed.data;
  return {
    brandbookId: value.fileId,
    name: value.name ?? value.fileName,
    fileName: value.fileName,
    size: value.size,
    createdAt: (value.createdAt && Date.parse(value.createdAt)) || 0,
    shared: value.shared ?? false,
    mine: value.mine ?? true,
    profile: value.profile,
  };
}

type Authority = BrandbookProfile['tokens'][number]['authority'];
const AUTHORITY_RANK: Record<Authority, number> = { explicit: 0, inferred: 1, observed: 2 };

export interface BrandbookColor {
  readonly hex: string;
  /** Роли из правил брендбука: primary, accent… Пусто — цвет только встречается в файлах. */
  readonly roles: readonly string[];
  readonly authority: Authority;
  /** Сколько раз цвет встретился среди извлечённых значений. */
  readonly count: number;
}

export interface BrandbookFont {
  readonly family: string;
  readonly roles: readonly string[];
  readonly authority: Authority;
  /** Сколько файлов шрифта этого семейства лежит в брендбуке. */
  readonly files: number;
}

export interface BrandbookMeasure {
  readonly id: string;
  readonly name: string;
  readonly kind: BrandbookProfile['tokens'][number]['kind'];
  readonly value: string;
  readonly role: string | null;
}

export interface BrandbookRule {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** Брендбук, разложенный на части: из этого рисуются карточка и страница брендбука. */
export interface BrandbookOverview {
  readonly colors: readonly BrandbookColor[];
  readonly fonts: readonly BrandbookFont[];
  readonly measures: readonly BrandbookMeasure[];
  readonly rules: readonly BrandbookRule[];
  readonly logos: BrandbookProfile['assets'];
  readonly images: BrandbookProfile['assets'];
  readonly fontFiles: BrandbookProfile['assets'];
  readonly examples: BrandbookProfile['assets'];
}

function normalHex(value: string | number): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  return match?.[1] ? match[1].toUpperCase() : null;
}

function better(current: Authority, next: Authority): Authority {
  return AUTHORITY_RANK[next] < AUTHORITY_RANK[current] ? next : current;
}

/**
 * Разложить профиль брендбука: одинаковые цвета и шрифты из разных файлов сливаются в одну
 * запись. Сначала идёт заявленное правилами, потом выведенное, потом лишь встреченное в файлах;
 * внутри — что встречается чаще.
 */
export function brandbookOverview(profile: BrandbookProfile): BrandbookOverview {
  const colors = new Map<
    string,
    { roles: Set<string>; authority: Authority; count: number; at: number }
  >();
  const fonts = new Map<
    string,
    { family: string; roles: Set<string>; authority: Authority; at: number }
  >();
  const measures: BrandbookMeasure[] = [];
  const rules: BrandbookRule[] = [];
  profile.tokens.forEach((token, at) => {
    if (token.kind === 'color') {
      const hex = normalHex(token.value);
      if (!hex) return;
      const entry = colors.get(hex) ?? {
        roles: new Set(),
        authority: token.authority,
        count: 0,
        at,
      };
      if (token.role) entry.roles.add(token.role);
      entry.authority = better(entry.authority, token.authority);
      entry.count += 1;
      colors.set(hex, entry);
      return;
    }
    if (token.kind === 'font-family') {
      const family = String(token.value).trim();
      if (!family) return;
      const key = family.toLowerCase();
      const entry = fonts.get(key) ?? { family, roles: new Set(), authority: token.authority, at };
      if (token.role) entry.roles.add(token.role);
      entry.authority = better(entry.authority, token.authority);
      fonts.set(key, entry);
      return;
    }
    if (token.kind === 'rule') {
      rules.push({ id: token.id, title: token.name, text: String(token.value) });
      return;
    }
    const unit = token.unit === 'percent' ? '%' : (token.unit ?? '');
    measures.push({
      id: token.id,
      name: token.name,
      kind: token.kind,
      value: `${token.value}${unit && unit !== '%' ? ` ${unit}` : unit}`,
      role: token.role,
    });
  });
  for (const section of profile.sections) {
    const text = section.text.trim();
    if (!text) continue;
    rules.push({ id: section.id, title: section.name || section.locator, text });
  }
  const fontFiles = profile.assets.filter((asset) => asset.kind === 'font');
  const filesOf = (family: string) =>
    fontFiles.filter((asset) => asset.fontFamily?.toLowerCase() === family.toLowerCase()).length;
  for (const asset of fontFiles) {
    const family = asset.fontFamily?.trim();
    if (!family || fonts.has(family.toLowerCase())) continue;
    fonts.set(family.toLowerCase(), {
      family,
      roles: new Set(),
      authority: 'observed',
      at: Number.MAX_SAFE_INTEGER,
    });
  }
  const order = (
    a: { authority: Authority; at: number },
    b: { authority: Authority; at: number },
  ) => AUTHORITY_RANK[a.authority] - AUTHORITY_RANK[b.authority] || a.at - b.at;
  return {
    colors: [...colors]
      .sort(
        ([, a], [, b]) =>
          AUTHORITY_RANK[a.authority] - AUTHORITY_RANK[b.authority] ||
          b.roles.size - a.roles.size ||
          b.count - a.count ||
          a.at - b.at,
      )
      .map(([hex, entry]) => ({
        hex,
        roles: [...entry.roles],
        authority: entry.authority,
        count: entry.count,
      })),
    fonts: [...fonts.values()].sort(order).map((entry) => ({
      family: entry.family,
      roles: [...entry.roles],
      authority: entry.authority,
      files: filesOf(entry.family),
    })),
    measures,
    rules,
    logos: profile.assets.filter((asset) => asset.kind === 'logo' || asset.kind === 'vector'),
    images: profile.assets.filter((asset) => asset.kind === 'image'),
    fontFiles,
    examples: profile.assets.filter((asset) => asset.kind === 'example'),
  };
}

/** Картинка для обложки: логотип, потом векторный знак, иначе первая картинка, которую можно показать. */
export function brandbookCoverAsset(profile: BrandbookProfile) {
  const shown = profile.assets.filter((asset) => canPreviewBrandbookAsset(asset.mediaType));
  return (
    shown.find((asset) => asset.kind === 'logo') ??
    shown.find((asset) => asset.kind === 'vector') ??
    shown[0] ??
    null
  );
}

/** Брендбук в меню поля генерации: имя и то, что видно в миниатюре, без всего профиля. */
export interface ComposerBrandbook {
  readonly brandbookId: string;
  readonly name: string;
  readonly colors: readonly string[];
  readonly colorCount: number;
  readonly fontCount: number;
}

export function composerBrandbookOf(brandbook: LibraryBrandbook): ComposerBrandbook {
  const overview = brandbookOverview(brandbook.profile);
  return {
    brandbookId: brandbook.brandbookId,
    name: brandbook.name,
    colors: overview.colors.slice(0, 5).map((color) => color.hex),
    colorCount: overview.colors.length,
    fontCount: overview.fonts.length,
  };
}
