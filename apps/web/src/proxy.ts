import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, authSecret, loginHref } from '@/lib/auth';
import { verifySessionToken } from '@/lib/session-token';

/**
 * Гостя — на вход. Здесь проверяется только подпись cookie: общих модулей с рендером у proxy
 * нет, и спросить, жив ли ещё пользователь, не у кого. Это делают макеты и действия
 * (`app/auth-session.ts`).
 *
 * Со страницы входа вошедшего не уводим: если пользователя убрали, а cookie осталась, вышла бы
 * петля «вход → главная → вход». Страница входа решает это сама, спросив источник аккаунтов.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, authSecret())) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(loginHref(`${pathname}${search}`), request.url));
}

export const config = {
  // Всё, кроме страницы входа, служебных файлов Next и статики из `public/`. И кроме прокси к API
  // (`app/api/backend`): через proxy Next пропускает только первые 10 МБ тела, а шаблон бывает
  // больше. Вход там проверяет сам маршрут и отвечает 401, а не уводом на страницу входа. Так же
  // отвечает `api/service-status`: гостю — 401, а не страница входа вместо JSON. Описание API
  // (`api/docs`, `api/docs-json`) открыто всем.
  matcher: [
    '/((?!login|api/backend/|api/service-status|api/docs|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpe?g|webp|ico|woff2?|ttf)$).*)',
  ],
};
