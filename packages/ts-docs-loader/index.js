// @ts-check

const fs = require('node:fs/promises');

const Loader = require('./src/loader');
const getTSResolver = require('./src/resolver');
const LoaderCache = require('./src/cache');

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('./src/transformer').Dependency} Dependency
 */

const LOADER_CACHE = new LoaderCache();

/**
 * @this {import('webpack').LoaderContext<{cache: LoaderCache}>}
 */
module.exports = async function docsLoader() {
  const callback = this.async();
  const tsResolver = getTSResolver(this.resourcePath);

  const loader = new Loader({
    async getSource(filePath) {
      const content = await fs.readFile(filePath);
      return content.toString();
    },
    async resolve(path, context) {
      const module = tsResolver(path, context);
      if (module?.resolvedFileName == null) {
        throw new Error(`Could not resolve ${path}`);
      }
      return module?.resolvedFileName;
    },
    cache: this.getOptions().cache ?? LOADER_CACHE,
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
