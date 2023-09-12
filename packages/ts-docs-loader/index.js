// @ts-check

/**
 * Adapted from parcel-transformer-docs and parcel-packager-docs from Adobe Spectrum.
 *
 * See https://github.com/adobe/react-spectrum/blob/main/packages/dev/parcel-transformer-docs/DocsTransformer.js.
 */

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

  IN_PROGRESS_SET.add(this.resourcePath);

  const resolve = this.getResolve({
    extensions: ['.ts', '.tsx', '.d.ts', '.js'],
    mainFields: ['source', 'types', 'main'],
  });
  const tsResolver = getTSResolver(context);

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
    isCurrentlyProcessing(filePath) {
      return IN_PROGRESS_SET.has(filePath);
    },
    async resolve(path) {
      const tsModule = tsResolver(path);
      const resolvedPath = tsModule?.resolvedModule?.resolvedFileName;
      if (resolvedPath == null) {
        throw `Could not resolve ${path}`;
      }
      return resolvedPath;
    },
    async importModule(filePath) {
      return webpackImport(`!!${thisLoaderPath}!${filePath}`, {}).catch((e) => {
        callback(e);
      });
    },
  };

  const loader = new Loader(adapter);
  const result = await loader.load(this.resourcePath);

  const code = `export default ${JSON.stringify(result)};`;
  callback(null, code);
  IN_PROGRESS_SET.delete(this.resourcePath);
};
