/**
 * Число из поля панели. Запятая и точка равноправны, пробелы между разрядами допустимы.
 * Пустая строка и мусор дают null: поле тогда просто возвращается к прежнему значению.
 */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(',', '.').replace(/^−/, '-');
  if (normalized === '' || normalized === '-' || normalized === '.') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Шаг стрелкой без «пыли» плавающей точки: 0.1 + 0.2 остаётся 0.3. */
export function stepNumber(value: number, delta: number): number {
  return Math.round((value + delta) * 1000) / 1000;
}
