/**
 * Which stored files an account may use: its own and those an administrator shared with
 * everyone, never deleted ones. `ownerParam` is the query parameter that holds the account id,
 * such as 2 for `$2`.
 */
export function visibleFile(ownerParam: number, alias = ''): string {
  const column = (name: string) => (alias ? `${alias}.${name}` : name);
  return `(${column('deleted_at')} IS NULL AND (${column('owner_id')} = $${ownerParam} OR ${column('shared')}))`;
}
