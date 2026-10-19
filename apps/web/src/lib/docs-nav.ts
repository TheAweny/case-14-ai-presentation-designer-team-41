/** What the product does that is easy to miss. The slug is the file and the URL segment. */
export const CAPABILITY_SLUGS = ['variants', 'assistant', 'editing', 'library'] as const;

export type CapabilitySlug = (typeof CAPABILITY_SLUGS)[number];

/** How the service is built. Same files, a separate group in the nav. */
export const GUIDE_SLUGS = ['pipeline', 'layers', 'contracts', 'decisions', 'access'] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export type ArticleSlug = CapabilitySlug | GuideSlug;

export function isCapabilitySlug(value: string): value is CapabilitySlug {
  return (CAPABILITY_SLUGS as readonly string[]).includes(value);
}

export function isGuideSlug(value: string): value is GuideSlug {
  return (GUIDE_SLUGS as readonly string[]).includes(value);
}

export function isArticleSlug(value: string): value is ArticleSlug {
  return isCapabilitySlug(value) || isGuideSlug(value);
}

/** Gradient used for the wordmark and page titles, the same clip as the login and the 404. */
export const DOCS_TITLE_CLASS =
  'bg-linear-to-b from-foreground from-30% to-[oklch(0.8_0.08_290)] bg-clip-text text-transparent';

/**
 * Reference pages, in the order of the nav. `tag` is the OpenAPI tag name, Russian, as the
 * document writes it. The visible label is translated separately.
 */
export const REFERENCE_PAGES = [
  { slug: 'generation', tag: 'Генерация' },
  { slug: 'editor', tag: 'Редактор' },
  { slug: 'files', tag: 'Файлы и шаблоны' },
  { slug: 'chats', tag: 'Чаты' },
  { slug: 'runs', tag: 'Прогоны' },
  { slug: 'library', tag: 'Библиотека' },
  { slug: 'models', tag: 'Модели' },
  { slug: 'users', tag: 'Пользователи' },
  { slug: 'auth', tag: 'Вход' },
  { slug: 'health', tag: 'Состояние' },
] as const;

/** The models catalogue. It is not an OpenAPI tag. */
export const SCHEMAS_SLUG = 'schemas';

export type DocsReferenceSlug = (typeof REFERENCE_PAGES)[number]['slug'] | typeof SCHEMAS_SLUG;

export function isDocsReferenceSlug(value: string): value is DocsReferenceSlug {
  return value === SCHEMAS_SLUG || REFERENCE_PAGES.some((page) => page.slug === value);
}

/** The OpenAPI tag for a reference slug, or undefined for the schemas page and unknown slugs. */
export function referenceTag(slug: string): string | undefined {
  return REFERENCE_PAGES.find((page) => page.slug === slug)?.tag;
}
