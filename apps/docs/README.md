# Портал документации

Статический сайт на Next.js и Fumadocs. Читается без API продукта, PostgreSQL, движка и моделей. Правила для авторов — в [AGENTS.md](./AGENTS.md), карта переноса — в [MIGRATION.md](./MIGRATION.md).

## Локально

```bash
yarn nx run docs:serve
```

Сайт открывается на `http://localhost:3002`. Ссылка «Приложение» по умолчанию ведёт на `http://localhost:3000`. Адреса меняются в `.env` по образцу `.env.example` (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_DOCS_URL`).

## Проверка

```bash
yarn nx run docs:build
yarn nx run docs:typecheck
yarn nx run docs:lint
yarn nx run docs:test
```

Сборка пишет `apps/docs/out`. OpenAPI снимается целью `api:export-openapi` до сборки и тестов: Nest читает декораторы, сервисы заменены заглушками, база не нужна.

## Отдельный хост

Портал рассчитан на поддомен, например `docs.lct.aweny.link`. Этот репозиторий не меняет DNS и compose продукта.

```bash
yarn nx run docs:build
# содержимое apps/docs/out — корень сайта
```

При сборке задайте канонический адрес и ссылку на приложение:

```bash
NEXT_PUBLIC_DOCS_URL=https://docs.lct.aweny.link \
NEXT_PUBLIC_APP_URL=https://lct.aweny.link \
yarn nx run docs:build
```

Nginx, каталог уже с `index.html` в каждой папке (`trailingSlash`):

```nginx
server {
  server_name docs.lct.aweny.link;
  root /var/www/lct-docs;
  location / {
    try_files $uri $uri/ $uri.html /404.html;
  }
}
```

Не проксируйте `/api/backend` на этом хосте. Такой путь есть только у приложения. Справочник API — статические страницы и файл `/openapi.json`.

Редирект с приложения на портал включается переменной `DOCS_PUBLIC_URL` на веб-сервере продукта и только для путей из `apps/web/src/lib/docs-portal.ts`. Страница `/api/docs` приложения остаётся на месте. Пока переменная не задана, поведение приложения не меняется.
