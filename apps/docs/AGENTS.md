# Документация

Портал `apps/docs` публикуется отдельно от продукта, в том числе на `docs.lct.aweny.link`.
Он собирается статически и открывается без API, PostgreSQL, Python-движка и моделей.

## Где что лежит

- Статьи: `content/docs/`. Русский без префикса локали. Английский появится как `content/docs/en` вместе с i18n Fumadocs; переключатель до этого не включается.
- Порядок боковой панели: `meta.json` в том же каталоге. Имя в `pages` — имя файла без расширения.
- Картинки: `public/images/<раздел>/`. В статье обязательны alt и подпись. Кадра нет — блока в статье нет: пустая рамка выглядит как недочёт. Готовый снимок — `<Figure>` или `<MediaSlot>` с `src`. Демонстрация без продукта — `public/images/sample-column.svg`.
- Сгенерированное, руками не править:
  - `content/docs/api/reference/`
  - `generated/openapi.json`
  - `public/openapi.json`
    Источник — `apps/api/src/docs/export-openapi.ts` (`yarn nx run api:export-openapi`).

## Как добавить страницу

1. Создать `content/docs/<раздел>/<имя>.mdx` (или `.md`) с `title` и `description`.
2. Вписать `<имя>` в `pages` соседнего `meta.json`.
3. Поставить внутреннюю ссылку вида `/docs/<раздел>/<имя>/`.
4. Если приложение должно уметь перенаправить на эту страницу, добавить путь в `apps/web/src/lib/docs-portal.ts`. Путь вне списка не редиректится. `/api/docs` приложения не трогать.

Компоненты статей подключены в `src/components/mdx.tsx`:

- примечания: `<Info>`, `<Tip>`, `<Warning>`, `<Limitation>`;
- перенесённая и не перепроверенная статья начинается с `<ReviewNote />`;
- шаги: `<Steps>` и `<Step>`;
- вкладки: `<Tabs items={[...]}>` и `<Tab>`;
- картинка с alt, подписью и увеличением: `<Figure src alt caption />`;
- запись экрана, только с файлом: `<MediaSlot kind="video" title="..." src="/images/..." />`;
- подробности: `<Accordions>` и `<Accordion title="...">`;
- код с именем файла: fenced-блок и `title="file.ts"`.

Исправленное при переносе `ReviewNote` не получает. В тексте прямо написано, что изменилось. Так помечены доступ к API (`x-lct-session`) и `schemaVersion`.

## Как запускать и проверять

```bash
yarn nx run docs:serve          # http://localhost:3002
yarn nx run api:export-openapi  # снимок OpenAPI и справочник
yarn nx run docs:build          # статический apps/docs/out
yarn nx run docs:typecheck
yarn nx run docs:lint
yarn nx run docs:test           # ссылки, картинки, секреты, список редиректов
```

`docs:build` и `docs:test` сами вызывают экспорт OpenAPI. Для него не нужны база и движок.

Адреса: `NEXT_PUBLIC_APP_URL` (ссылка «Приложение»), `NEXT_PUBLIC_DOCS_URL` (канонический адрес). Пример — `.env.example`. На сервере продукта редирект включается только переменной `DOCS_PUBLIC_URL`.

## Как подтверждать утверждения

`docs/` в корне репозитория не считать описанием текущего поведения. Существенное утверждение сверять с кодом: CLI — `apps/cli`, доступ — `apps/api/src/accounts/account.guard.ts` и `apps/web/src/lib/api.ts`, контракты — `packages/contracts`. Не выдумывать флаги, поля схем и различия вариантов. Если поведение ещё меняется, страница начинается с `<ReviewNote />`, а не закрепляет черновик как спецификацию.

Не переносить в портал отчёты, планы, handoff и исторические исследования из `docs/`. Карта уже перенесённого — `MIGRATION.md`.

Не публиковать значения `API_SERVICE_TOKEN`, `AUTH_SECRET`, паролей и строк `DATABASE_URL`. Имена переменных допустимы.
