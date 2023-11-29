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
 *
 * @typedef TsDocsLoaderOptions
 * @property {LoaderCache} [cache] An optional cache instance to use while loading docs.
 * Only needed if you have multiple usages of the loader that should not interact (i.e., in tests).
 * @property {string} [basePath] An optional path to strip from the start of all file paths when
 * used as IDs. Useful if you want to be able to use the ID to generate GitHub links, for example.
 * Otherwise, all file paths will be printed as absolute paths (potentially including usernames).
 */

const LOADER_CACHE = new LoaderCache();
let isGlobalCacheTapped = false;

/**
 * @this {import('webpack').LoaderContext<TsDocsLoaderOptions>}
 */
module.exports = async function docsLoader() {
  const callback = this.async();

  const cache = this.getOptions().cache ?? LOADER_CACHE;
  const basePath = this.getOptions().basePath ?? '/';
  const tsResolver = getTSResolver(this.resourcePath);

  // This loader is considered cacheable by webpack, meaning it should only
  // be called when webpack determines that the cache needs to be busted. With
  // that assumption, the loader cache should also be invalidated so that the
  // file can be fully processed again.
  cache.invalidateFile(this.resourcePath);

  // Listen for watch mode invalidations and remove entries from the cache if
  // they change. But ensure that only one tap is hooked up to the global
  // LOADER_CACHE to ensure it doesn't leak or slow down from too many events.
  if (cache !== LOADER_CACHE || !isGlobalCacheTapped) {
    this._compiler?.hooks.invalid.tap(LOADER_NAME, (filePath) => {
      if (filePath == null) return;
      cache.invalidateFile(filePath);
    });
    // If this was the global cache, mark it as tapped
    if (cache === LOADER_CACHE) isGlobalCacheTapped = true;
  }

  const loader = new Loader({
    // Strip out the starting basePath if it's present, creating a relative
    // path. Otherwise just return the whole path.
    trimPath(path) {
      if (path.startsWith(basePath)) {
        return path.substring(basePath.length);
      }
      return path;
    },
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
