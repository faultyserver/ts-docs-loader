// @ts-check

const fs = require('node:fs/promises');

const Loader = require('./src/loader');
const getTSResolver = require('./src/resolver');
const LoaderCache = require('./src/cache');

const LOADER_NAME = 'ts-docs-loader';

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('./src/transformer').Dependency} Dependency
 */

const LOADER_CACHE = new LoaderCache();
let isGlobalCacheTapped = false;

/**
 * @this {import('webpack').LoaderContext<{cache: LoaderCache}>}
 */
module.exports = async function docsLoader() {
  const callback = this.async();
  const tsResolver = getTSResolver(this.resourcePath);

  const cache = this.getOptions().cache ?? LOADER_CACHE;
  // Assume that if we're loading again, webpack has determined we need to bust the cache.
  cache.deleteResource(this.resourcePath, []);

  // Listen for watch mode invalidations and remove entries from the cache if
  // they change. But ensure that only one tap is hooked up to the global
  // LOADER_CACHE to ensure it doesn't leak or slow down from too many events.
  if (cache !== LOADER_CACHE || !isGlobalCacheTapped) {
    this._compiler?.hooks.invalid.tap(LOADER_NAME, (filePath) => {
      if (filePath == null) return;
      cache.deleteResource(filePath, []);
    });
    // If this was the global cache, mark it as tapped
    if (cache === LOADER_CACHE) isGlobalCacheTapped = true;
  }

  const loader = new Loader({
    async getSource(filePath) {
      const content = await fs.readFile(filePath);
      return content.toString();
    },
    async resolve(path, context) {
      const module = tsResolver(path, context);
      if (module.resolvedModule?.resolvedFileName == null) {
        throw new Error(`Could not resolve ${path}. Module resolution gave: ${module}`);
      }
      return module.resolvedModule?.resolvedFileName;
    },
    cache,
  });

  try {
    const result = await loader.load(this.resourcePath);
    const code = `export default ${JSON.stringify(result)};`;
    callback(null, code);
  } catch (e) {
    console.log(e);
    callback(e);
  }
};
