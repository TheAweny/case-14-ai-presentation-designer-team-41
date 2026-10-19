import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The portal is a static site: articles, search index and the OpenAPI snapshot
  // are produced at build time and do not need the product API, Postgres or the engine.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withMDX(nextConfig);
