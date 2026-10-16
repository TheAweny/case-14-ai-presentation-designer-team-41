import { fetchBrowserDocument } from '@/lib/api-docs';

/**
 * The API's OpenAPI document, open to anyone like the page that draws it (`/api/docs`): it
 * describes routes and holds no data. The API serves it to this server; the answer here names
 * `/api/backend` as the server, the way the browser reaches the API.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const document = await fetchBrowserDocument();
  if (!document) return Response.json({ message: 'The API is not answering.' }, { status: 503 });
  return Response.json(document, {
    headers: { 'content-disposition': 'inline; filename="openapi.json"' },
  });
}
