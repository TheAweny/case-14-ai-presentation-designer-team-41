---
title: "Модели"
description: "Подключения к моделям и выбор модели для каждой роли пайплайна. Ключи наружу не уходят."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

Подключения к моделям и выбор модели для каждой роли пайплайна. Ключи наружу не уходят.

## `GET /model-settings`
**Настройки моделей**
Подключения и модель для каждой роли пайплайна. Ключ не возвращается никогда: только `hasKey` и последние символы.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ModelSettings](/docs/api/reference/schemas/#ModelSettings) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `GET /model-settings/capabilities`
**Возможности модели**
Как у модели включается размышление и меняет ли что-то глубина. Узнаётся короткими запросами к самой модели при первом обращении и запоминается; по имени модели ничего не решается.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ModelCapabilities](/docs/api/reference/schemas/#ModelCapabilities) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |

## `POST /model-settings/connections`
**Сохранить подключение**
Без `connectionId` — новое, с ним — правка. Пустой `apiKey` при правке оставляет сохранённый ключ. Ключ хранится зашифрованным (AES-256-GCM).
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [ConnectionInput](/docs/api/reference/schemas/#ConnectionInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 201 | Создано или запущено. | [ModelConnection](/docs/api/reference/schemas/#ModelConnection) |
| 400 | Неверный ввод; в `problems` — что не так по полям. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 409 | Подключение задано окружением сервера и не редактируется. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 503 | Хранилище ключей недоступно: не задан `MODEL_KEYS_SECRET`. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `DELETE /model-settings/connections/{id}`
**Удалить подключение**
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Подключение удалено. | — |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 409 | Подключение задано окружением сервера и не редактируется. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `POST /model-settings/connections/{id}/check`
**Проверить подключение**
Запрашивает у сервера список моделей и запоминает результат в `lastCheck`.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ModelConnection](/docs/api/reference/schemas/#ModelConnection) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 503 | Хранилище ключей недоступно: не задан `MODEL_KEYS_SECRET`. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `PUT /model-settings/connections/{id}/kinds`
**Тип модели вручную**
Что умеет модель подключения: текст, картинки на входе, картинки на выходе, голос. Ручной выбор главнее описания провайдера; `kinds: null` возвращает описание провайдера.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да | Подключение. |

### Тело запроса

- `application/json` — [ManualKindsInput](/docs/api/reference/schemas/#ManualKindsInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Тип модели сохранён. | — |
| 400 | Неверный ввод; в `problems` — что не так по полям. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 409 | Подключение задано окружением сервера и не редактируется. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `PUT /model-settings/connections/{id}/models`
**Какие модели подключения доступны**
`null` снимает ограничение, пустой список выключает все модели.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |
| `id` | path | да |  |

### Тело запроса

- `application/json` — [ConnectionModelsInput](/docs/api/reference/schemas/#ConnectionModelsInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ModelConnection](/docs/api/reference/schemas/#ModelConnection) |
| 400 | Неверный ввод; в `problems` — что не так по полям. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 409 | Подключение задано окружением сервера и не редактируется. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `POST /model-settings/probe`
**Проверить адрес и ключ до сохранения**
С `connectionId` и без ключа берётся сохранённый ключ.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [ProbeInput](/docs/api/reference/schemas/#ProbeInput)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 200 | Успешно. | [ConnectionCheck](/docs/api/reference/schemas/#ConnectionCheck) |
| 400 | Неверный ввод; в `problems` — что не так по полям. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 503 | Хранилище ключей недоступно: не задан `MODEL_KEYS_SECRET`. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |

## `PUT /model-settings/roles`
**Назначить модель роли**
Роль пайплайна: планировщик, писатель, критик, зрение, картинки. Выбор администратора — по умолчанию для всех.
### Параметры

| Имя | Где | Обязателен | Описание |
| --- | --- | --- | --- |
| `x-lct-session` | header | да | Серверный session token из /auth/verify. Отзывается при logout и изменении доступа. |

### Тело запроса

- `application/json` — [RoleAssignment](/docs/api/reference/schemas/#RoleAssignment)

### Ответы

| Код | Описание | Схема |
| --- | --- | --- |
| 204 | Роль назначена. | — |
| 400 | Неверный ввод; в `problems` — что не так по полям. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
| 401 | Нет входа: аккаунт не назван, удалён или отключён. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 403 | Нет прав: запрос не от веб-сервера или действие только для администратора. | [ApiError](/docs/api/reference/schemas/#ApiError) |
| 404 | Подключения нет. | [ModelSettingsError](/docs/api/reference/schemas/#ModelSettingsError) |
