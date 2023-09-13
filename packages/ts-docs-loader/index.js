// @ts-check

const thisLoaderPath = require.resolve('./index.js');

const Loader = require('./src/loader');
const getTSResolver = require('./src/resolver');

/**
 * Map containing all files that are currently being processed by the loader,
 * as a naive way of dealing with circular dependencies.
 */
const IN_PROGRESS_SET = new Set();

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('./src/transformer').Dependency} Dependency
 */

/**
 * @this import('webpack').LoaderContext<any>
 * @param {string} source Raw source of the asset
 */
module.exports = async function docsLoader(source) {
  const {context, importModule: webpackImport, resourcePath} = this;
  const callback = this.async();

  // resourceQuery includes the `?`, so it needs to get sliced off.
  const requestedSymbols = this.resourceQuery.length > 0 ? this.resourceQuery.slice(1).split(',') : undefined;

  IN_PROGRESS_SET.add(this.resource);

  const tsResolver = getTSResolver(this.resourcePath);

  /** @type {import('./src/loader').Bundler} */
  const adapter = {
    async getSource() {
      return source;
    },
    getFilePath() {
      return resourcePath;
    },
    getContext() {
      return context;
    },
    isCurrentlyProcessing(filePath, symbols) {
      const resource = `${filePath}?${symbols.join(',')}`;
      return IN_PROGRESS_SET.has(resource);
    },
    async resolve(path) {
      const resolvedPath = tsResolver(path);
      if (resolvedPath == null) {
        throw new Error(`Could not resolve ${path}`);
      }
      return resolvedPath;
    },
    async importModule(filePath, requestedSymbols) {
      const symbolQuery = requestedSymbols.join(',');
      const result = await webpackImport(`!!${thisLoaderPath}!${filePath}?${symbolQuery}`, {}).catch((e) => {
        callback(e);
      });

      return result.default;
    },
  };

  const loader = new Loader(adapter);
  const result = await loader.load(this.resourcePath, requestedSymbols).catch((e) => {
    callback(e);
    throw e;
  });

  const code = `export default ${JSON.stringify(result)};`;
  callback(null, code);
  IN_PROGRESS_SET.delete(this.resource);
};
