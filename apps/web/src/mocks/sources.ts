import { createHttpDeckSource } from '../lib/http-generation';
import { createDemoLibrary } from './demo-library';
import { createDemoModelSettings } from './demo-model-settings';
import { createPersistentLibrarySource } from '../lib/persistent-library-source';

/**
 * Источники данных приложения, пока API нет. Страницы берут их отсюда и знают только
 * интерфейсы `DeckSource` и `LibrarySource`: HTTP-клиент встанет на это место, не трогая страниц.
 *
 * Библиотека и источник колод делят одно состояние: что переименовали или удалили в меню,
 * то редактор и откроет (или не откроет).
 *
 * Генератора здесь нет: он работает только во вкладке и живёт в сессии ассистента
 * (`components/assistant/session.ts`) — там же видно, как он находит шаблоны сервера.
 */
// Production UI starts empty. Seeded data remains available only to isolated mock tests/fixtures.
const demo = createDemoLibrary({ seedDemo: false });

export const deckSource = createHttpDeckSource();
export const librarySource = createPersistentLibrarySource(demo.library);

/**
 * Подключения к серверам моделей и роли пайплайна. Читает и меняет их только сервер — через
 * действия `app/settings-actions.ts`: ключи живут здесь и в браузер не уходят.
 */
export const modelSettingsSource = createDemoModelSettings();
