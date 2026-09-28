import { permanentRedirect } from 'next/navigation';
import { chatHref } from '@/lib/library-menu';

/** Старый адрес чата: разговоры переехали на `/chats/…`. */
export default async function LegacyChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  permanentRedirect(chatHref((await params).threadId));
}
