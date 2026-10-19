---
title: "Прогоны"
description: "Состояние прогона и журнал его событий по этапам пайплайна."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Состояние прогона и журнал его событий по этапам пайплайна.

## `POST /runs`
**Завести пустой прогон**
Прогон в состоянии `queued`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 202 | Принято. | [RunRecord](/docs/api/reference/schemas/#runrecord) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |

## `GET /runs/{runId}`
**Состояние прогона**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `runId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [RunRecord](/docs/api/reference/schemas/#runrecord) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#apierror) |

## `GET /runs/{runId}/events`
**События прогона**
Журнал по этапам: начало, прогресс, конец этапа, готовый артефакт, предупреждения. Опрашивается с `after` — номером последнего полученного события.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `after` | query | нет | Вернуть события с номером больше этого. |
| `runId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[JobEvent](/docs/api/reference/schemas/#jobevent)&gt; |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#apierror) |

## `POST /runs/validate-inputs`
**Проверить конфиг прогона**
Тот же конфиг, что у `lct generate --config`. Проверяет, что шаблон и материалы на месте и читаются, а каталог результата доступен на запись.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [RunConfig](/docs/api/reference/schemas/#runconfig)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [ValidatedInputs](/docs/api/reference/schemas/#validatedinputs) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#apierror) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#apierror) |
