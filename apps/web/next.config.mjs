import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

// Находит src/i18n/request.ts сам: там выбирается язык запроса и грузится словарь.
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolated browser tests can run alongside an existing development server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  // Standalone output keeps the runtime image free of the build toolchain.
  output: 'standalone',
  // The workspace root, so tracing picks up files from packages/ as well.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Левый нижний угол занят подвалом колонки слайдов, индикатор dev-сборки его закрывал.
  devIndicators: { position: 'bottom-right' },
  async redirects() {
    return [
      // Мастера нового шаблона больше нет: новая презентация и новый шаблон начинаются в поле
      // генерации на главной (`NEW_DECK_HREF` в lib/library-menu.ts). Старые закладки ведут туда.
      { source: '/new', destination: '/?compose=1', permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
