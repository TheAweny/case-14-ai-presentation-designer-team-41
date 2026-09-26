/**
 * Что показать о последнем аудите колоды: не запускали, замечаний нет или сколько их.
 * Отдельно от карточки, чтобы правило проверялось тестом без рендера.
 */
export type AuditStatus =
  | { readonly kind: 'notRun' }
  | { readonly kind: 'clean' }
  | { readonly kind: 'findings'; readonly count: number };

export function auditStatusOf(findings: number | null): AuditStatus {
  if (findings === null) return { kind: 'notRun' };
  if (findings <= 0) return { kind: 'clean' };
  return { kind: 'findings', count: findings };
}
