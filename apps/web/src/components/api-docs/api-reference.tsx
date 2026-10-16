'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Swagger UI over the API's document, in the interface's theme (`api-docs.css`). The bundle
 * is loaded here, in the browser, and only on this page: it is large and nothing else needs it.
 *
 * Swagger UI ships a dark theme switched by `dark-mode` on `<html>`; the page turns it on while it
 * is open and the theme file repaints it in the interface's colors.
 */
export function ApiReference({ spec }: { spec: object }) {
  const t = useTranslations('apiDocs');
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark-mode');
    let cancelled = false;
    void import('swagger-ui-dist/swagger-ui-es-bundle.js').then(({ default: SwaggerUI }) => {
      if (cancelled || !root.current) return;
      SwaggerUI({
        domNode: root.current,
        spec,
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: false,
        syntaxHighlight: { activated: true, theme: 'tomorrow-night' },
        onComplete: () => setReady(true),
      });
    });
    return () => {
      cancelled = true;
      html.classList.remove('dark-mode');
    };
  }, [spec]);

  return (
    <div className="api-docs">
      {ready ? null : (
        <p className="assistant-shimmer mx-auto max-w-6xl px-4 py-10 text-sm sm:px-6">
          {t('loading')}
        </p>
      )}
      <div ref={root} />
    </div>
  );
}
