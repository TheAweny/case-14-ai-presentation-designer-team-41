'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Swagger UI over one slice of the API document, in the interface's theme (`api-docs.css`).
 * The bundle is loaded here, in the browser, and only on a reference page: it is large and
 * nothing else needs it.
 *
 * `operations` hides the models catalogue (it has its own page). `schemas` draws only that
 * catalogue. Swagger UI's dark theme follows `dark-mode` on `<html>`; this view turns it on
 * while it is open.
 */
export function ApiReference({ spec, mode }: { spec: object; mode: 'operations' | 'schemas' }) {
  const t = useTranslations('apiDocs');
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const node = root.current;
    html.classList.add('dark-mode');
    let cancelled = false;
    setReady(false);
    void import('swagger-ui-dist/swagger-ui-es-bundle.js').then(({ default: SwaggerUI }) => {
      if (cancelled || !node) return;
      node.replaceChildren();
      SwaggerUI({
        domNode: node,
        spec,
        deepLinking: true,
        docExpansion: mode === 'operations' ? 'list' : 'none',
        defaultModelsExpandDepth: mode === 'schemas' ? 1 : -1,
        defaultModelExpandDepth: mode === 'schemas' ? 1 : 2,
        displayRequestDuration: true,
        filter: mode === 'operations',
        tryItOutEnabled: false,
        syntaxHighlight: { activated: true, theme: 'tomorrow-night' },
        onComplete: () => {
          if (cancelled) return;
          // The catalogue is mounted after this callback, and Swagger leaves it shut. The
          // schemas page is that list, so open it once the button is in the document.
          if (mode === 'schemas') {
            let attempts = 0;
            const openModels = () => {
              if (cancelled) return;
              const control = node.querySelector('section.models button.models-control');
              if (
                control instanceof HTMLButtonElement &&
                control.getAttribute('aria-expanded') === 'false'
              ) {
                control.click();
              }
              const opened = control?.getAttribute('aria-expanded') === 'true';
              if (!opened && attempts < 8) {
                attempts += 1;
                requestAnimationFrame(openModels);
              }
            };
            openModels();
          }
          setReady(true);
        },
      });
    });
    return () => {
      cancelled = true;
      node?.replaceChildren();
      html.classList.remove('dark-mode');
    };
  }, [spec, mode]);

  return (
    <div
      className={mode === 'schemas' ? 'api-docs api-docs-schemas' : 'api-docs api-docs-operations'}
    >
      {ready ? null : <p className="assistant-shimmer py-6 text-sm">{t('loading')}</p>}
      <div ref={root} />
    </div>
  );
}
