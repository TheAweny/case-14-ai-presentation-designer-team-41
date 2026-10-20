/** Public address of the product. Set at build time; the portal does not call it. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Canonical address of this portal, including a local static server. */
export function docsUrl(): string {
  return (process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3002').replace(/\/$/, '');
}
