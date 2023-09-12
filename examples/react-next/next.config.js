/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@faulty/ts-docs-type-renderer'],
  webpack(config) {
    config.resolveLoader = {
      ...config.resolveLoader,
      alias: {
        ...config.resolveLoader.alias,
        doc: '@faulty/ts-docs-loader',
      },
    };

    return config;
  },
};

module.exports = nextConfig;
