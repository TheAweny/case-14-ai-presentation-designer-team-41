---
title: "Библиотека"
description: "Проекты: папки для колод, чатов и шаблонов."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Проекты: папки для колод, чатов и шаблонов.

## `GET /library/projects`
**Проекты**
С шаблонами проекта и числом колод.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[ListedProject](/docs/api/reference/schemas/#ListedProject)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /library/projects`
**Создать проект**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [ProjectInput](/docs/api/reference/schemas/#ProjectInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [Project](/docs/api/reference/schemas/#Project) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /library/projects/{id}`
**Удалить проект**
Вместе с его колодами.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | object |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /library/projects/{id}`
**Изменить проект**
Имя, значок с цветом или закрепление в меню. Закрепление не двигает дату правки.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Тело запроса

- `application/json` — [ProjectInput](/docs/api/reference/schemas/#ProjectInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Project](/docs/api/reference/schemas/#Project) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /library/projects/{projectId}/templates/{templateId}`
**Убрать шаблон из проекта**
Сам шаблон остаётся в библиотеке.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `projectId` | path | да |  |
| `templateId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Ok](/docs/api/reference/schemas/#Ok) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /library/projects/{projectId}/templates/{templateId}`
**Добавить шаблон в проект**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `projectId` | path | да |  |
| `templateId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [Ok](/docs/api/reference/schemas/#Ok) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
