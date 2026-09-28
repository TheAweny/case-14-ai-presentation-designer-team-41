import type { KeyValueStore } from './draft-storage';

/**
 * Находки аудита, которые человек пропустил: фигура нарочно вынесена под обрез, огромное слово
 * нарочно режется краем. Как отключённое правило в линтере — находка уходит из счёта, но её
 * можно вернуть.
 *
 * Хранятся в том же хранилище браузера, что и черновик колоды, отдельной записью: слайды и
 * пропуски меняются независимо, и автосохранение слайдов о пропусках не знает. В контракте колоды
 * места для них пока нет, поэтому они не уходят ни в экспорт, ни на другой компьютер.
 */

const PREFIX = 'audit-ignored:';

export function ignoresKey(deckId: string): string {
  return `${PREFIX}${deckId}`;
}

/** Записанные пропуски; всё, что не список строк, — как будто пропусков нет. */
export function readIgnores(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id !== '');
}

export async function loadIgnores(
  store: KeyValueStore,
  deckId: string,
): Promise<readonly string[]> {
  return readIgnores(await store.get(ignoresKey(deckId)));
}

/** Записать пропуски; пустой список стирает запись, чтобы не копить пустые. */
export async function saveIgnores(
  store: KeyValueStore,
  deckId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) await store.del(ignoresKey(deckId));
  else await store.set(ignoresKey(deckId), [...ids]);
}
