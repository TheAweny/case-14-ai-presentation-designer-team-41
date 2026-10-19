---
title: "Состояние"
description: "Живы ли API, движок и база данных."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Живы ли API, движок и база данных.

## `GET /health`
**API живо**
Открыт без токена: для Docker и установщика.
### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [HealthCheck](/docs/api/reference/schemas/#healthcheck) |

## `GET /health/database`
**PostgreSQL отвечает**
### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [HealthCheck](/docs/api/reference/schemas/#healthcheck) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#apierror) |

## `GET /health/engine`
**Python-движок жив**
### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [HealthCheck](/docs/api/reference/schemas/#healthcheck) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#apierror) |
