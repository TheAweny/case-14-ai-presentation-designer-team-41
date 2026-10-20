import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, authSecret, loginHref } from '@/lib/auth';
import { docsPortalDestination } from '@/lib/docs-portal';
import { verifySessionToken } from '@/lib/session-token';
import { apiDocsEnabled, isApiDocsPath } from '@/lib/api-docs-access';

/**
 * Гостя — на вход. Здесь проверяется только подпись cookie: общих модулей с рендером у proxy
 * нет, и спросить, жив ли ещё пользователь, не у кого. Это делают макеты и действия
 * (`app/auth-session.ts`).
 *
 * Со страницы входа вошедшего не уводим: если пользователя убрали, а cookie осталась, вышла бы
 * петля «вход → главная → вход». Страница входа решает это сама, спросив источник аккаунтов.
 */
export async function proxy(request: NextRequest) {
  const docs = docsPortalDestination(request.nextUrl.pathname, process.env.DOCS_PUBLIC_URL);
  if (docs) return NextResponse.redirect(docs);
  // Decide before rendering/streaming so disabled docs always return an HTTP 404.
  if (isApiDocsPath(request.nextUrl.pathname)) {
    return apiDocsEnabled()
      ? NextResponse.next()
      : new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, authSecret())) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(loginHref(`${pathname}${search}`), request.url));
}

export const config = {
  // Всё, кроме страницы входа, служебных файлов Next и статики из `public/`. И кроме прокси к API
  // (`app/api/backend`): через proxy Next пропускает только первые 10 МБ тела, а шаблон бывает
  // больше. Вход там проверяет сам маршрут и отвечает 401, а не уводом на страницу входа. Так же
  // отвечает `api/service-status`: гостю — 401, а не страница входа вместо JSON. Консоль
  // документации (`api/docs-playground`) тоже вне proxy: портал на другом хосте шлёт bearer,
  // а не cookie, и загружает файлы. Описание API (`api/docs`, `api/docs-json`) открыто всем
  // только при API_DOCS_ENABLED=true.
  matcher: [
    '/api/docs/:path*',
    '/api/docs-json/:path*',
    '/((?!login|api/backend/|api/docs-playground/|api/service-status|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpe?g|webp|ico|woff2?|ttf)$).*)',
  ],
};
