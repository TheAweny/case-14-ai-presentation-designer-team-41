---
title: "Генерация"
description: "Подготовка шаблона, сборка трёх вариантов колоды, редактор и экспорт в PPTX, PDF, PNG и HTML."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Подготовка шаблона, сборка трёх вариантов колоды, редактор и экспорт в PPTX, PDF, PNG и HTML.

## `GET /generation`
**Колоды библиотеки**
Одна запись на сборку: вариант, выбранный в чате, или первый готовый.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[LibraryDeck](/docs/api/reference/schemas/#LibraryDeck)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /generation`
**Собрать колоду**
Запускает три варианта вёрстки (`dense`, `balanced`, `airy`) по одному плану. Ответ приходит сразу; ход каждого варианта — в `GET /runs/{runId}/events`. Бюджет на три варианта — 5 минут.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [GenerationRequest](/docs/api/reference/schemas/#GenerationRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [StartedBuild](/docs/api/reference/schemas/#StartedBuild) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /generation/{id}`
**Удалить колоду**
Вместе с остальными вариантами сборки.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Колода удалена. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /generation/{id}`
**Переименовать или перенести колоду**
Все варианты сборки меняются вместе. `projectId: null` — вынести из проекта.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Тело запроса

- `application/json` — [DeckPatch](/docs/api/reference/schemas/#DeckPatch)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Ok](/docs/api/reference/schemas/#Ok) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/artifacts/{name}`
**Скачать артефакт сборки**
Файл, каким его собрал пайплайн.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `name` | path | да | `slide-N.png` — превью слайда N. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Артефакт. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /generation/{id}/cancel`
**Остановить сборку**
Варианты, которые ещё идут, прерываются.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [Ok](/docs/api/reference/schemas/#Ok) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/deck`
**Колода для редактора**
Дизайн-система, IR шаблона и слайды, прочитанные обратно из `.pptx`. Если движок не смог прочитать файл, `slides` нет и редактор собирает их из IR шаблона.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | object |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /generation/{id}/export`
**Экспорт отредактированной колоды**
Движок заново собирает нативный PPTX из слайдов редактора, поэтому скачанный файл совпадает с тем, что на экране. PDF, PNG и HTML строятся из него же. Файлы — в `GET /generation/{id}/exports/{exportId}/{name}`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Тело запроса

- `application/json` — [ExportRequest](/docs/api/reference/schemas/#ExportRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [ExportedDeck](/docs/api/reference/schemas/#ExportedDeck) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/exports/{exportId}/{name}`
**Скачать экспорт**
Файл, собранный `POST /generation/{id}/export`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `name` | path | да |  |
| `exportId` | path | да |  |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Файл экспорта. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/media/{name}`
**Картинка колоды**
Изображения слайдов для редактора.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `name` | path | да |  |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Изображение. | string |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/previews`
**Превью слайдов**
Имена файлов; сами файлы — в `artifacts`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;string&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /generation/{id}/resume`
**Продолжить сборку с сохранённых задач**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/summary`
**Сводка колоды для карточки чата**
Без повторного чтения `.pptx`: обложка уже нарисована.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | id готового варианта колоды. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [DeckSummary](/docs/api/reference/schemas/#DeckSummary) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/{id}/usage`
**Накопленный расход сборки, включая неудачные попытки и продолжения**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /generation/prepare`
**Подготовить шаблон**
Один раз на шаблон и вне бюджета генерации: профиль, описание каждого макета моделью и превью слайдов. Отвечает, когда шаблон готов; повторный вызов для готового шаблона возвращается сразу.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [PrepareRequest](/docs/api/reference/schemas/#PrepareRequest)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | object |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 503 | Недоступен движок, база данных или хранилище ключей. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /generation/prepare/{templateId}`
**Ход подготовки шаблона**
Этап и сколько макетов описано; страница, открытая посреди подготовки, следит за ней.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `templateId` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [TemplatePreparation](/docs/api/reference/schemas/#TemplatePreparation) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
