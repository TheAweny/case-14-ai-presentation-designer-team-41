import type { Locale } from './config';
import type messages from './messages/ru';

/**
 * Типы next-intl: ключи сверяются с русским словарём, он исходный. Опечатка в ключе или
 * отсутствующая строка ломают проверку типов, а совпадение английского словаря с русским
 * держит тест `messages.spec.ts`.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
