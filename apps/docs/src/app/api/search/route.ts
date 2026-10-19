import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

const server = createFromSource(source);

export const revalidate = false;

export function GET() {
  return server.staticGET();
}
