# Поиск в интернете через внутренний SearXNG

Поиск для агентов — отдельный контейнер `search` в [`compose.yaml`](../compose.yaml). Это собственный экземпляр [SearXNG](https://docs.searxng.org/admin/installation-docker.html), без платных API. Образ закреплён по digest индекса `searxng/searxng@sha256:8bdd9aa136b2dc3b9332cf24714fa34a375b8a1949a1201ec900c24d7378596e` (проверка `docker buildx imagetools inspect searxng/searxng:latest`).

Сервис не публикует порт на хост: только `expose: 8080` в сети compose. Снаружи контейнеров его нет.

## Как вызывает API

Переменная `WEB_SEARCH_URL` задаётся сервису `api`. В compose подстановка такая:

```text
${WEB_SEARCH_URL-http://search:8080}
```

Дефис, не `:- `. Если переменная не задана, адрес по умолчанию — `http://search:8080`. Явная пустая строка отключает поиск: `WEB_SEARCH_URL=`, `WEB_SEARCH_URL=""` и `WEB_SEARCH_URL=''` в `.env` все три дают пустое значение.

Запрос к JSON API ([документация](https://docs.searxng.org/dev/search_api.html)):

```text
GET {WEB_SEARCH_URL}/search?q=...&format=json
```

`infra/searxng/settings.yml` включает `search.formats: [html, json]` при `use_default_settings: true`. Без `json` в списке форматов SearXNG отвечает 403 на `format=json`. `server.limiter: false`, потому что экземпляр внутренний и Valkey рядом нет. Выдача — ссылки и фрагменты чужих страниц, это не гарантия достоверности.

## Пустое значение

Отключение в `.env`:

```text
WEB_SEARCH_URL=
```

API не ждёт health `search` и не зависит от него в `depends_on`. Если контейнер поиска остановлен или не готов, чат и остальной API остаются рабочими; недоступен только веб-поиск.

## Секрет

`server.secret_key` в репозитории не настоящий. Контейнер читает `SEARXNG_SECRET`. Пустое или отсутствующее значение перед официальным entrypoint заменяется на строку из `/dev/urandom` в окружении процесса и никуда не записывается. Стабильный ключ между перезапусками задают только в локальном `.env`, который не коммитится. В `.env.example` поле пустое.

Файл настроек смонтирован только для чтения. `FORCE_OWNERSHIP=false`, чтобы entrypoint не пытался сделать `chown` на этот файл. Кэш лежит в томе `search-data`.

## Хост и внешний SearXNG

Для `next dev` на хосте укажите уже запущенный SearXNG, свой или внешний:

```text
WEB_SEARCH_URL=http://127.0.0.1:8080
```

Контейнер `search` при этом можно не поднимать. Порт наружу этот compose не открывает: адрес выше — это другой процесс, который вы запустили сами.
