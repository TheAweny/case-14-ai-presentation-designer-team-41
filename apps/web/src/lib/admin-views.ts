/**
 * Новый раздел — это id здесь, компонент в карте панели и строки title/body
 * в обоих словарях.
 */

export const ADMIN_VIEWS = ['overview', 'people', 'limits', 'metrics'] as const;

export type AdminView = (typeof ADMIN_VIEWS)[number];

const VIEWS: readonly string[] = ADMIN_VIEWS;

/** Незнакомое, пустое и отсутствующее значение открывают обзор. */
export function adminView(value: string | null | undefined): AdminView {
  return VIEWS.includes(value ?? '') ? (value as AdminView) : 'overview';
}
