import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

// Находит src/i18n/request.ts сам: там выбирается язык запроса и грузится словарь.
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the runtime image free of the build toolchain.
  output: 'standalone',
  // The workspace root, so tracing picks up files from packages/ as well.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Левый нижний угол занят подвалом колонки слайдов, индикатор dev-сборки его закрывал.
  devIndicators: { position: 'bottom-right' },
};

export default withNextIntl(nextConfig);
