---
title: "Пользователи"
description: "Свой профиль и управление аккаунтами для администратора."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Свой профиль и управление аккаунтами для администратора.

## `GET /account-usage/{id}`
**Политика и активность аккаунта**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [AccountUsageView](/docs/api/reference/schemas/#AccountUsageView) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PUT /account-usage/{id}`
**Изменить опциональные ограничения аккаунта**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [AccountPolicy](/docs/api/reference/schemas/#AccountPolicy)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [AccountUsageView](/docs/api/reference/schemas/#AccountUsageView) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /account-usage/me`
**Своя активность и включённые ограничения**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [AccountUsageView](/docs/api/reference/schemas/#AccountUsageView) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /users`
**Все аккаунты**
Только администратор.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | array&lt;[Account](/docs/api/reference/schemas/#Account)&gt; |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /users`
**Создать аккаунт**
Самостоятельной регистрации нет: аккаунты заводит администратор.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [AccountInput](/docs/api/reference/schemas/#AccountInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [Account](/docs/api/reference/schemas/#Account) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `DELETE /users/{id}`
**Удалить аккаунт**
Вместе со всем, что он создал. Себя и последнего администратора удалить нельзя.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Аккаунт и его данные удалены. | — |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /users/{id}`
**Изменить аккаунт**
Почта, имя, пароль, роль или отключение. Себя понизить или отключить нельзя.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Тело запроса

- `application/json` — [AccountPatch](/docs/api/reference/schemas/#AccountPatch)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Account](/docs/api/reference/schemas/#Account) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Объекта нет или он принадлежит другому аккаунту. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 409 | Конфликт состояния: действие сейчас невозможно. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /users/{id}/revoke-sessions`
**Отозвать все сессии аккаунта**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Готово, тела нет. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /users/me`
**Свой аккаунт**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Account](/docs/api/reference/schemas/#Account) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `PATCH /users/me`
**Изменить свой профиль**
Картинку и пароль меняет каждый сам; для смены пароля нужен текущий.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [ProfilePatch](/docs/api/reference/schemas/#ProfilePatch)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [Account](/docs/api/reference/schemas/#Account) |
| 400 | Неверный запрос: тело или параметры не прошли проверку. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
