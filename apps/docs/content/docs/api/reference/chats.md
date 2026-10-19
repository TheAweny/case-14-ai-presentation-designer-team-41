---
title: "Чаты"
description: "Разговор с ассистентом: ход отвечает потоком server-sent events."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Разговор с ассистентом: ход отвечает потоком server-sent events.

## `GET /chats`
**Чаты**
Новые сверху.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `deckId` | query | нет | Чат, в котором собрана колода. |
| `projectId` | query | нет | Только чаты проекта. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[ChatSummary](/docs/api/reference/schemas/#ChatSummary)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /chats/{id}`
**Удалить чат**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Чат удалён, вместе с его колодами. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /chats/{id}`
**Чат целиком**
Все сообщения и идёт ли сейчас ответ.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ChatDocument](/docs/api/reference/schemas/#ChatDocument) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /chats/{id}`
**Переименовать, перенести или выбрать вариант**
`projectId: null` выносит чат из проекта; `deckId` — вариант, к которому ведёт чат.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Тело запроса

- `application/json` — [ChatPatch](/docs/api/reference/schemas/#ChatPatch)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ChatSummary](/docs/api/reference/schemas/#ChatSummary) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /chats/{id}/cancel`
**Остановить ход**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Ход остановлен или уже закончился. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /chats/{id}/stream`
**Подключиться к идущему ходу**
После перезагрузки страницы: сначала ответ как он есть, затем новые события. Хода нет — поток сразу закрывается.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | События идущего хода. Каждое событие — строка `data: &lt;ChatEvent JSON&gt;`; поток закрывает `turn-end`. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /chats/{id}/turns`
**Отправить ход и получить ответ потоком**
Сообщение, ответ на вопрос агента или одобренный план. Чата с таким id ещё нет — он создаётся. Ответ идёт потоком; если поток закрыть, ход продолжится.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Тело запроса

- `application/json` — [ChatTurnRequest](/docs/api/reference/schemas/#ChatTurnRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | События хода. Каждое событие — строка `data: &lt;ChatEvent JSON&gt;`; поток закрывает `turn-end`. | string |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /chats/{id}/variants/retry`
**Пересобрать упавший вариант**
По плану, который сохранила сборка. Отвечает обновлённой карточкой результата.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id чата (UUID). |

### Тело запроса

- `application/json` — [RetryVariant](/docs/api/reference/schemas/#RetryVariant)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [ChatPart](/docs/api/reference/schemas/#ChatPart) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |
