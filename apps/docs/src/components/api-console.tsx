'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getDocsAccount, subscribeDocsAccount } from '@/lib/account-store';
import { consoleDocument, type ConsoleDocument } from '@/lib/console-spec';
import { appUrl } from '@/lib/site';
import 'swagger-ui-dist/swagger-ui.css';

/**
 * Swagger UI over the build-time OpenAPI snapshot. Requests go to the application, which adds
 * the service token. The bearer is the account from the header of this site.
 */
export function ApiConsole() {
  const root = useRef<HTMLDivElement>(null);
  const session = useSyncExternalStore(subscribeDocsAccount, getDocsAccount, () => null);
  const [spec, setSpec] = useState<ConsoleDocument | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/openapi.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('missing');
        setSpec((await response.json()) as ConsoleDocument);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark-mode');
    return () => html.classList.remove('dark-mode');
  }, []);

  useEffect(() => {
    if (!spec || !root.current) return;
    const node = root.current;
    let cancelled = false;
    node.replaceChildren();
    void import('swagger-ui-dist/swagger-ui-es-bundle.js').then(({ default: SwaggerUI }) => {
      if (cancelled) return;
      SwaggerUI({
        domNode: node,
        spec: consoleDocument(spec, `${appUrl()}/api/docs-playground`),
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        persistAuthorization: false,
        syntaxHighlight: { activated: true, theme: 'tomorrow-night' },
        requestInterceptor: (request) => {
          const token = getDocsAccount()?.token;
          if (token) request.headers.Authorization = `Bearer ${token}`;
          return request;
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  return (
    <div className="api-console">
      <p className="text-sm text-fd-muted-foreground">
        {session
          ? `Запросы идут от аккаунта «${session.account.name}». Кнопка Execute отправляет их в приложение.`
          : 'Чтобы отправить запрос, войдите кнопкой «Войти» внизу боковой панели или в шапке главной. Без входа сервер ответит 401.'}
      </p>
      {failed ? (
        <p role="alert" className="mt-4 text-sm">
          Не удалось прочитать снимок OpenAPI этой сборки.
        </p>
      ) : null}
      {spec ? null : failed ? null : (
        <p className="mt-6 text-sm text-fd-muted-foreground">Открываю справочник…</p>
      )}
      <div ref={root} className="mt-2" />
    </div>
  );
}
