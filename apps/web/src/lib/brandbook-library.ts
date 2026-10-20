import { apiFetch } from './api';
import { libraryBrandbookOf, type LibraryBrandbook } from './brandbooks';

/** Брендбука нет или он чужой и не открыт всем. */
export class BrandbookNotFoundError extends Error {
  override readonly name = 'BrandbookNotFoundError';
  constructor(readonly brandbookId: string) {
    super(`Brandbook not found: ${brandbookId}`);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await apiFetch(path, init);
  if (response.status === 404) throw new BrandbookNotFoundError(path);
  if (!response.ok) throw new Error(`Brandbook API failed: ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

/** Брендбуки аккаунта и общие, новые первыми. API недоступен — библиотека брендбуков пуста. */
export async function listBrandbooks(): Promise<readonly LibraryBrandbook[]> {
  const rows = await request('/files/brandbooks').catch(() => []);
  return Array.isArray(rows)
    ? rows.flatMap((row) => {
        const brandbook = libraryBrandbookOf(row);
        return brandbook ? [brandbook] : [];
      })
    : [];
}

export async function updateBrandbook(
  brandbookId: string,
  patch: { name?: string; shared?: boolean },
): Promise<void> {
  await request(`/files/brandbooks/${encodeURIComponent(brandbookId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteBrandbook(brandbookId: string): Promise<void> {
  await request(`/files/brandbooks/${encodeURIComponent(brandbookId)}`, { method: 'DELETE' });
}
