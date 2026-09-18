import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the runtime image free of the build toolchain.
  output: 'standalone',
  // The workspace root, so tracing picks up files from packages/ as well.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};

export default nextConfig;
