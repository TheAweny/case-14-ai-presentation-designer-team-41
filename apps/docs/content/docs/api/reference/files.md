---
title: "Файлы и шаблоны"
description: "Загрузка шаблона `.pptx`/`.potx` и материалов; библиотека шаблонов и их превью."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Загрузка шаблона `.pptx`/`.potx` и материалов; библиотека шаблонов и их превью.

## `GET /files`
**Все файлы аккаунта**
Шаблоны и материалы, новые сверху.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[StoredFile](/docs/api/reference/schemas/#StoredFile)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /files/content`
**Загрузить материалы**
Текст или таблица для колоды: `.txt`, `.md`, `.docx`, `.pdf`, `.csv`, `.tsv`, `.xlsx`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `multipart/form-data` — object

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 202 | Принято. | [StoredFile](/docs/api/reference/schemas/#StoredFile) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /files/template`
**Загрузить шаблон**
Принимает `.pptx` или `.potx`. Движок разбирает файл до ответа: в `profile` — палитра, шрифты, сетка и макеты шаблона.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `multipart/form-data` — object

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 202 | Принято. | [StoredFile](/docs/api/reference/schemas/#StoredFile) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 422 | Движок не смог прочитать файл. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 504 | Движок не ответил вовремя. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /files/templates`
**Шаблоны**
Свои и открытые всем администратором.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[StoredFile](/docs/api/reference/schemas/#StoredFile)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /files/templates/{id}`
**Убрать шаблон из библиотеки**
Файл остаётся: колоды на этом шаблоне открываются и экспортируются.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Шаблон убран. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /files/templates/{id}`
**Переименовать или открыть шаблон всем**
Переименовывает владелец; `shared` меняет только администратор.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Тело запроса

- `application/json` — [TemplatePatch](/docs/api/reference/schemas/#TemplatePatch)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [StoredFile](/docs/api/reference/schemas/#StoredFile) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /files/templates/{id}/download`
**Скачать исходный шаблон**
Оригинальные байты `.pptx` или `.potx`. Свой шаблон и открытый всем; чужой личный и убранный из библиотеки — нет.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Исходный файл шаблона. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /files/templates/{id}/previews/{name}`
**Превью слайда шаблона**
Нарисовано при подготовке шаблона.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `name` | path | да |  |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | PNG слайда. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
