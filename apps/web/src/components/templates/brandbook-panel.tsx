import type { ReactNode } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { BrandbookAsset } from '@lct/contracts';
import { fontStackOf } from '@/components/library/template-swatch';
import { FileIcon, ImageIcon, WarningIcon } from '@/components/ui/icons';
import {
  brandbookAssetUrl,
  brandbookOverview,
  canPreviewBrandbookAsset,
  type BrandbookFont,
  type LibraryBrandbook,
} from '@/lib/brandbooks';
import { BrandbookCover } from './brandbook-library';

/** Сколько цветов и фрагментов текста видно сразу; остальное — под «Ещё». */
const COLORS_SHOWN = 16;
const RULES_SHOWN = 6;
const KNOWN_ROLES = new Set([
  'primary',
  'secondary',
  'accent',
  'background',
  'text',
  'heading',
  'body',
  'caption',
  'all',
]);

/** Файл шрифта, которым рисовать образец семейства: прямое обычное начертание, если оно есть. */
function fontFileOf(brandbook: LibraryBrandbook, family: string): BrandbookAsset | null {
  const files = brandbook.profile.assets.filter(
    (asset) => asset.kind === 'font' && asset.fontFamily?.toLowerCase() === family.toLowerCase(),
  );
  const upright = files.filter((asset) => !/italic|oblique/i.test(asset.name));
  return (
    upright.find((asset) => /regular|\[wght\]/i.test(asset.name)) ?? upright[0] ?? files[0] ?? null
  );
}

/**
 * Разбор брендбука под сеткой, как профиль шаблона: файл и итог разбора, палитра, шрифты,
 * размеры, логотипы, изображения, примеры, правила и что из файлов прочиталось. Показывается
 * ровно то, что извлёк движок; пустые части не рисуются.
 */
export async function BrandbookPanel({ brandbook }: { brandbook: LibraryBrandbook }) {
  const [t, format] = await Promise.all([getTranslations('brandbooksPage.panel'), getFormatter()]);
  const { profile } = brandbook;
  const overview = brandbookOverview(profile);
  const imported = new Date(brandbook.createdAt);
  // Шрифты брендбука подгружаются из его же файлов под своими именами: имя файла в CSS не попадает.
  const faces = overview.fonts.flatMap((font, index) => {
    const file = fontFileOf(brandbook, font.family);
    return file
      ? [
          {
            family: font.family,
            alias: `brandbook-font-${index}`,
            url: brandbookAssetUrl(brandbook.brandbookId, file.id),
          },
        ]
      : [];
  });
  const fontStack = (family: string) => {
    const face = faces.find((item) => item.family === family);
    return face ? `"${face.alias}", ${fontStackOf(family)}` : fontStackOf(family);
  };
  const roleName = (role: string) =>
    KNOWN_ROLES.has(role) ? t(`roles.${role as 'primary'}`) : role;
  const fontNote = (font: BrandbookFont) => {
    const label =
      font.roles.length > 0
        ? font.roles.map(roleName).join(', ')
        : t(`authority.${font.authority}`);
    return font.files > 0 ? `${label} · ${t('fontFiles', { count: font.files })}` : label;
  };
  const colors = overview.colors.slice(0, COLORS_SHOWN);
  const moreColors = overview.colors.slice(COLORS_SHOWN);

  return (
    <div className="flex flex-col gap-8">
      {faces.length > 0 ? (
        <style>
          {faces
            .map(
              (face) =>
                `@font-face{font-family:"${face.alias}";src:url("${face.url}");font-display:swap}`,
            )
            .join('\n')}
        </style>
      ) : null}

      <section
        aria-labelledby="brandbook-profile"
        className="grid gap-6 rounded-lg bg-card p-4 ring-1 ring-border md:p-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h2 id="brandbook-profile" className="text-base font-semibold">
            {t('heading')}
          </h2>
          <BrandbookCover brandbook={brandbook} className="w-full" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium break-all">{brandbook.name}</p>
            {brandbook.name !== brandbook.fileName ? (
              <p className="text-xs break-all text-muted-foreground">{brandbook.fileName}</p>
            ) : null}
            {brandbook.createdAt > 0 ? (
              <p className="text-xs text-muted-foreground">
                <time dateTime={imported.toISOString()}>
                  {t('imported', { date: format.dateTime(imported, { dateStyle: 'long' }) })}
                </time>
              </p>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('status')}</dt>
            <dd>{profile.status === 'ready' ? t('statusReady') : t('statusPartial')}</dd>
            <dt className="text-muted-foreground">{t('files')}</dt>
            <dd className="tabular-nums">
              {t('filesValue', {
                parsed: profile.coverage.filesParsed,
                total: profile.coverage.filesTotal,
              })}
            </dd>
            <dt className="text-muted-foreground">{t('assets')}</dt>
            <dd className="tabular-nums">{profile.assets.length}</dd>
          </dl>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('palette')}
            </h3>
            {colors.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">{t('paletteHint')}</p>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
                  {colors.map((color) => (
                    <li
                      key={color.hex}
                      className="flex min-w-0 items-center gap-2.5 rounded-md p-1.5 ring-1 ring-border"
                    >
                      <span
                        aria-hidden
                        className="size-8 shrink-0 rounded ring-1 ring-foreground/15"
                        style={{ backgroundColor: `#${color.hex}` }}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-medium">
                          {color.roles.length > 0
                            ? color.roles.map(roleName).join(', ')
                            : t(`authority.${color.authority}`)}
                        </span>
                        <span className="font-mono text-[0.6875rem] text-muted-foreground uppercase">
                          #{color.hex}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {moreColors.length > 0 ? (
                  <details className="flex flex-col gap-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                      {t('paletteMore', { count: moreColors.length })}
                    </summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {moreColors.map((color) => (
                        <li
                          key={color.hex}
                          title={`#${color.hex}`}
                          className="size-6 rounded ring-1 ring-foreground/15"
                          style={{ backgroundColor: `#${color.hex}` }}
                        >
                          <span className="sr-only">#{color.hex}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noColors')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('fonts')}
            </h3>
            {overview.fonts.length > 0 ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5">
                {overview.fonts.map((font) => (
                  <div key={font.family} className="contents">
                    <dt className="text-xs text-muted-foreground">{fontNote(font)}</dt>
                    <dd
                      className="truncate text-base"
                      style={{ fontFamily: fontStack(font.family) }}
                    >
                      {font.family}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noFonts')}</p>
            )}
          </div>
        </div>
      </section>

      {overview.measures.length > 0 ? (
        <PanelSection id="brandbook-measures" title={t('measures')} hint={t('measuresHint')}>
          <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
            {overview.measures.map((measure) => (
              <li
                key={measure.id}
                className="grid min-w-0 gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center"
              >
                <span className="truncate text-sm">{measure.name}</span>
                <span className="text-xs text-muted-foreground">
                  {measure.role ? roleName(measure.role) : null}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums sm:text-right">
                  {measure.value}
                </span>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <AssetSection
        id="brandbook-logos"
        title={t('logos')}
        hint={t('logosHint')}
        assets={overview.logos}
        brandbook={brandbook}
        noPreview={t('noPreview')}
      />
      <AssetSection
        id="brandbook-images"
        title={t('images')}
        hint={t('imagesHint')}
        assets={overview.images}
        brandbook={brandbook}
        noPreview={t('noPreview')}
      />
      <AssetSection
        id="brandbook-examples"
        title={t('examples')}
        hint={t('examplesHint')}
        assets={overview.examples}
        brandbook={brandbook}
        noPreview={t('noPreview')}
      />

      {overview.fontFiles.length > 0 ? (
        <details className="flex flex-col gap-3">
          <summary className="flex cursor-pointer items-baseline gap-2 text-sm font-semibold text-muted-foreground select-none">
            {t('fontFilesHeading')}
            <span className="text-xs font-normal tabular-nums">{overview.fontFiles.length}</span>
          </summary>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-2">
            {overview.fontFiles.map((asset) => (
              <li key={asset.id} className="min-w-0">
                <a
                  href={brandbookAssetUrl(brandbook.brandbookId, asset.id)}
                  download
                  aria-label={t('download', { name: asset.name })}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs ring-1 ring-border hover:bg-muted/60"
                >
                  <FileIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{asset.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {overview.rules.length > 0 ? (
        <PanelSection
          id="brandbook-rules"
          title={t('rules')}
          hint={t('rulesHint')}
          count={overview.rules.length}
        >
          <ul className="flex flex-col gap-2">
            {overview.rules.slice(0, RULES_SHOWN).map((rule) => (
              <RuleItem key={rule.id} title={rule.title} text={rule.text} />
            ))}
          </ul>
          {overview.rules.length > RULES_SHOWN ? (
            <details className="flex flex-col gap-2">
              <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                {t('rulesMore', { count: overview.rules.length - RULES_SHOWN })}
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {overview.rules.slice(RULES_SHOWN).map((rule) => (
                  <RuleItem key={rule.id} title={rule.title} text={rule.text} />
                ))}
              </ul>
            </details>
          ) : null}
        </PanelSection>
      ) : null}

      <PanelSection id="brandbook-coverage" title={t('coverage')} hint={t('coverageHint')}>
        {profile.coverage.needsOcr || profile.warnings.length > 0 ? (
          <div
            role="note"
            className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-sm ring-1 ring-border"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <WarningIcon size={16} aria-hidden />
              {t('warnings')}
            </span>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
              {profile.coverage.needsOcr ? <li>{t('needsOcr')}</li> : null}
              {profile.warnings.map((warning, index) => (
                <li key={index} className="break-words">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border">
          {profile.sources.map((source) => (
            <li
              key={source.id}
              className="grid min-w-0 gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem] sm:items-center"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm" title={source.path}>
                  {source.path.split('!/').at(-1)}
                </span>
                {source.warnings.length > 0 ? (
                  <span className="text-xs break-words text-muted-foreground">
                    {source.warnings.join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground uppercase">{source.format}</span>
              <span
                className={
                  source.status === 'parsed'
                    ? 'text-xs text-muted-foreground sm:text-right'
                    : 'text-xs font-medium text-destructive sm:text-right'
                }
              >
                {t(`sourceStatus.${source.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </PanelSection>
    </div>
  );
}

function PanelSection({
  id,
  title,
  hint,
  count,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="flex items-baseline gap-2 text-base font-semibold">
          {title}
          {count !== undefined ? (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>
          ) : null}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function RuleItem({ title, text }: { title: string; text: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2.5 ring-1 ring-border">
      <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
      <p className="line-clamp-4 text-sm break-words whitespace-pre-line">{text}</p>
    </li>
  );
}

/** Ресурсы одного вида сеткой: картинку видно, остальное — значок, имя и ссылка на файл. */
function AssetSection({
  id,
  title,
  hint,
  assets,
  brandbook,
  noPreview,
}: {
  id: string;
  title: string;
  hint: string;
  assets: readonly BrandbookAsset[];
  brandbook: LibraryBrandbook;
  noPreview: string;
}) {
  if (assets.length === 0) return null;
  return (
    <PanelSection id={id} title={title} hint={hint} count={assets.length}>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-x-4 gap-y-4">
        {assets.map((asset) => {
          const url = brandbookAssetUrl(brandbook.brandbookId, asset.id);
          const preview = canPreviewBrandbookAsset(asset.mediaType);
          return (
            <li key={asset.id} className="min-w-0">
              <a href={url} download className="flex min-w-0 flex-col gap-1.5 outline-none">
                <span
                  aria-hidden
                  className="grid aspect-[4/3] place-items-center overflow-hidden rounded-md bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] ring-1 ring-border"
                >
                  {preview ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain p-2"
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-muted-foreground">
                      {asset.mediaType.startsWith('image/') ? (
                        <ImageIcon size={22} />
                      ) : (
                        <FileIcon size={22} />
                      )}
                      <span className="text-[0.6875rem]">{noPreview}</span>
                    </span>
                  )}
                </span>
                <span className="truncate px-0.5 text-xs text-muted-foreground" title={asset.name}>
                  {asset.name}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}
