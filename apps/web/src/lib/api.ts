/** Base URL of the API, configured per environment. */
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Builds an absolute URL for an API route. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
