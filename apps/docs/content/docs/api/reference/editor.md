---
title: "Редактор"
description: "Серверные снимки колоды из редактора: редакция, картинки и экспорт зафиксированной редакции."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Серверные снимки колоды из редактора: редакция, картинки и экспорт зафиксированной редакции.

## `GET /editor/decks/{deckId}/exports/{exportId}/{name}`
**Скачать экспорт редакции**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `name` | path | да |  |
| `exportId` | path | да |  |
| `deckId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Файл экспорта. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /editor/decks/{deckId}/media`
**Записать картинку снимка**
Байты на диске, в базе только ссылка. Повтор тех же байт — та же ссылка.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `deckId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [EditorMediaPutResponse](/docs/api/reference/schemas/#EditorMediaPutResponse) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /editor/decks/{deckId}/media/{mediaPart}`
**Скачать картинку снимка**
Один сегмент пути: upload%2F&lt;id&gt;.png. Чужой аккаунт получает 404.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `mediaPart` | path | да |  |
| `deckId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Картинка. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /editor/decks/{deckId}/revisions/{revision}/export`
**Экспорт редакции**
Файл собирается из сохранённой редакции. Правки после этого запроса в него не попадают. Модель не вызывается.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `revision` | path | да |  |
| `deckId` | path | да |  |

### Тело запроса

- `application/json` — [EditorRevisionExportRequest](/docs/api/reference/schemas/#EditorRevisionExportRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [EditorRevisionExportResponse](/docs/api/reference/schemas/#EditorRevisionExportResponse) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /editor/decks/{deckId}/snapshot`
**Снимок колоды**
Последняя редакция, сохранённая этим аккаунтом. Чужой колоды нет. Снимка ещё нет — snapshot: null.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `deckId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [EditorSnapshotLoad](/docs/api/reference/schemas/#EditorSnapshotLoad) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /editor/decks/{deckId}/snapshot`
**Сохранить редакцию**
Публикуется только когда все картинки уже записаны. expectedRevision — редакция, которую клиент видел. Та же редакция у двух клиентов не перезаписывается молча: в ответе конфликт, обе копии сохранены. Повтор с тем же idempotencyKey возвращает первый результат.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `deckId` | path | да |  |

### Тело запроса

- `application/json` — [EditorSnapshotSaveRequest](/docs/api/reference/schemas/#EditorSnapshotSaveRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [EditorSnapshotSaveResponse](/docs/api/reference/schemas/#EditorSnapshotSaveResponse) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |
