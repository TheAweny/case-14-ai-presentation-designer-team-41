'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getDocsAccount, subscribeDocsAccount } from '@/lib/account-store';
import {
  consoleDocument,
  consoleOutline,
  type ConsoleDocument,
  type ConsoleOperation,
} from '@/lib/console-spec';
import { appUrl } from '@/lib/site';
import 'swagger-ui-dist/swagger-ui.css';

/**
 * Swagger UI over the build-time OpenAPI snapshot, skinned like the rest of the site.
 * The contents list is ours: Swagger's own bar does not match the docs navigation.
 * Requests go to the application, which adds the service token.
 */
export function ApiConsole() {
  const root = useRef<HTMLDivElement>(null);
  const session = useSyncExternalStore(subscribeDocsAccount, getDocsAccount, () => null);
  const [spec, setSpec] = useState<ConsoleDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<string | null>(null);

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
        defaultModelsExpandDepth: -1,
        defaultModelExpandDepth: 1,
        displayRequestDuration: true,
        filter: false,
        tryItOutEnabled: false,
        persistAuthorization: false,
        syntaxHighlight: { activated: true, theme: 'agate' },
        requestInterceptor: (request: { headers: Record<string, string> }) => {
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

  const groups = useMemo(() => groupOutline(spec ? consoleOutline(spec) : []), [spec]);

  return (
    <div className="api-console mt-8">
      <p className="text-sm text-fd-muted-foreground">
        {session
          ? `Запросы идут от аккаунта «${session.account.name}».`
          : 'Чтобы отправить запрос, нажмите «Войти»: откроется приложение и отдаст текущую сессию.'}
      </p>
      {failed ? (
        <p role="alert" className="mt-4 text-sm">
          Не удалось прочитать снимок OpenAPI этой сборки.
        </p>
      ) : null}
      {spec ? null : failed ? null : (
        <p className="mt-6 text-sm text-fd-muted-foreground">Открываю справочник…</p>
      )}
      <div className="mt-4 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label="Операции" className="mb-6 lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100vh-8rem)] lg:overflow-auto">
          {groups.map((group) => (
            <div key={group.tag} className="mb-4">
              <p className="px-2 text-xs font-medium tracking-wide text-fd-muted-foreground">
                {group.tag}
              </p>
              <ul className="mt-1">
                {group.operations.map((operation) => (
                  <li key={operation.operationId}>
                    <button
                      type="button"
                      className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-fd-accent ${
                        active === operation.operationId ? 'bg-fd-accent text-fd-foreground' : 'text-fd-muted-foreground'
                      }`}
                      onClick={() => {
                        setActive(operation.operationId);
                        revealOperation(operation.operationId);
                      }}
                    >
                      <span className="w-12 shrink-0 font-mono text-[10px] tracking-wide text-fd-primary">
                        {operation.method}
                      </span>
                      <span className="truncate">{operation.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div ref={root} className="min-w-0" />
      </div>
    </div>
  );
}

function groupOutline(operations: readonly ConsoleOperation[]) {
  const groups: { tag: string; operations: ConsoleOperation[] }[] = [];
  for (const operation of operations) {
    const last = groups[groups.length - 1];
    if (last?.tag === operation.tag) last.operations.push(operation);
    else groups.push({ tag: operation.tag, operations: [operation] });
  }
  return groups;
}

function revealOperation(operationId: string): void {
  const node = document.querySelector(`.opblock[id$="${cssEscape(operationId)}"]`);
  if (!(node instanceof HTMLElement)) return;
  if (!node.classList.contains('is-open')) {
    node.querySelector<HTMLElement>('.opblock-summary')?.click();
  }
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
