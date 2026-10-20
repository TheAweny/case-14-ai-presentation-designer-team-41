/** Server runtime setting: documentation is disabled unless explicitly enabled. */
export function apiDocsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.API_DOCS_ENABLED === 'true';
}

export function isApiDocsPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return ['/api/docs', '/api/docs-json'].some(
    (base) => path === base || path.startsWith(`${base}/`),
  );
}
