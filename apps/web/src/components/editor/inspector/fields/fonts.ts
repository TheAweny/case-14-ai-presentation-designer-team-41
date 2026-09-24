/**
 * Список шрифтов для выбора: шрифты шаблона сверху, под ними все остальные.
 *
 * «Все шрифты» по умолчанию — распространённые семейства: какие стоят у человека, браузер без
 * разрешения не скажет. По кнопке спрашиваем систему через Local Font Access API
 * (`window.queryLocalFonts`, есть в Chromium) и показываем то, что установлено на самом деле.
 */

/** Семейства, которые почти всегда есть в Windows, macOS или в веб-шрифтах шаблонов. */
export const COMMON_FONTS: readonly string[] = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Century Gothic',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Medium',
  'Garamond',
  'Georgia',
  'Helvetica',
  'Helvetica Neue',
  'Impact',
  'Inter',
  'Lato',
  'Lucida Console',
  'Montserrat',
  'Noto Sans',
  'Noto Serif',
  'Open Sans',
  'Palatino Linotype',
  'PT Mono',
  'PT Sans',
  'PT Serif',
  'Roboto',
  'Roboto Mono',
  'Segoe UI',
  'Source Sans 3',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Семейства без повторов и пустых строк, по алфавиту. Local Font Access отдаёт каждое
 * начертание отдельно — у «Arial» их четыре, в списке нужен один.
 */
export function uniqueFamilies(families: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of families) {
    const family = raw.trim();
    if (family === '') continue;
    const key = family.toLocaleLowerCase('en');
    if (!seen.has(key)) seen.set(key, family);
  }
  return [...seen.values()].sort(collator.compare);
}

/**
 * Совпадения с запросом: сначала семейства, которые с него начинаются, затем те, где он
 * внутри. Порядок внутри каждой группы сохраняется. Пустой запрос — весь список.
 */
export function filterFamilies(families: readonly string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return [...families];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const family of families) {
    const name = family.toLocaleLowerCase();
    if (name.startsWith(needle)) starts.push(family);
    else if (name.includes(needle)) contains.push(family);
  }
  return [...starts, ...contains];
}

export type FontRow =
  | { readonly kind: 'header'; readonly group: 'template' | 'all' }
  | { readonly kind: 'font'; readonly family: string; readonly group: 'template' | 'all' };

/**
 * Строки списка: заголовок группы и её шрифты. Шрифт шаблона во «Всех» не повторяется,
 * пустая после поиска группа не показывает и заголовка.
 */
export function buildFontRows(
  templateFonts: readonly string[],
  allFonts: readonly string[],
  query: string,
): FontRow[] {
  const template = filterFamilies(uniqueFamilies(templateFonts), query);
  const templateKeys = new Set(
    uniqueFamilies(templateFonts).map((family) => family.toLocaleLowerCase('en')),
  );
  const rest = filterFamilies(
    uniqueFamilies(allFonts).filter((family) => !templateKeys.has(family.toLocaleLowerCase('en'))),
    query,
  );
  const rows: FontRow[] = [];
  if (template.length > 0) {
    rows.push({ kind: 'header', group: 'template' });
    for (const family of template) rows.push({ kind: 'font', family, group: 'template' });
  }
  if (rest.length > 0) {
    rows.push({ kind: 'header', group: 'all' });
    for (const family of rest) rows.push({ kind: 'font', family, group: 'all' });
  }
  return rows;
}

/** Следующая строка-шрифт в направлении `direction`, заголовки пропускаются. */
export function nextFontIndex(rows: readonly FontRow[], from: number, direction: 1 | -1): number {
  const fonts = rows.flatMap((row, index) => (row.kind === 'font' ? [index] : []));
  const first = fonts[0] ?? -1;
  const last = fonts[fonts.length - 1] ?? -1;
  if (from < 0) return direction === 1 ? first : last;
  if (direction === 1) return fonts.find((index) => index > from) ?? last;
  return fonts.findLast((index) => index < from) ?? first;
}

/** CSS `font-family` для превью: имя в кавычках и системный запасной шрифт. */
export function fontFamilyCss(family: string): string {
  return `"${family.replace(/["\\]/g, '')}", system-ui, sans-serif`;
}

interface LocalFontData {
  readonly family: string;
}

type QueryLocalFonts = () => Promise<readonly LocalFontData[]>;

export function canQueryLocalFonts(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

let localFonts: Promise<string[]> | null = null;
let loadedLocalFonts: string[] | null = null;

/** Уже полученные шрифты компьютера — чтобы список при повторном открытии не мигал. */
export function cachedLocalFonts(): string[] | null {
  return loadedLocalFonts;
}

/**
 * Шрифты компьютера. Браузер спросит разрешение один раз; ответ запоминаем на всю сессию
 * страницы. Отказ или ошибка не запоминаются: человек может передумать и нажать снова.
 */
export function loadLocalFonts(): Promise<string[]> {
  if (!canQueryLocalFonts()) return Promise.reject(new Error('Local Font Access is unavailable'));
  localFonts ??= (window as unknown as { queryLocalFonts: QueryLocalFonts })
    .queryLocalFonts()
    .then((fonts) => {
      loadedLocalFonts = uniqueFamilies(fonts.map((font) => font.family));
      return loadedLocalFonts;
    })
    .catch((error: unknown) => {
      localFonts = null;
      throw error;
    });
  return localFonts;
}
