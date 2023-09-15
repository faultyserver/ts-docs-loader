// @ts-check

/**
 * A cache that persists across loader requests to let the loader re-use
 * results of processing a file, even if the current request hasn't yet
 * processed it.
 *
 * The key is the combination of file name and requested symbols, to ensure
 * that every unique request is handled propertly.
 *
 * Eventually this should be used to allow caching at the symbol level, where
 * the cache is checked for every symbol and only unfound symbols are then
 * requested in the next load.
 *
 */
module.exports = class LoaderCache {
  /** @type {Map<string, import("./loader").LoadResult>} */
  cache = new Map();

  constructor() {}

  /**
   * @param {string} filePath
   * @param {string[]} symbols
   */
  getResource(filePath, symbols) {
    return this.cache.get(this.makeResourceKey(filePath, symbols));
  }

  /**
   * @param {string} filePath
   * @param {string[]} symbols
   * @param {import("./loader").LoadResult} result
   */
  setResourceResult(filePath, symbols, result) {
    this.cache.set(this.makeResourceKey(filePath, symbols), result);
  }

  /**
   * @param {string} filePath
   * @param {string[]} symbols
   */
  deleteResource(filePath, symbols) {
    this.cache.delete(this.makeResourceKey(filePath, symbols));
  }

  /**
   * @param {string} filePath
   * @param {string[]} symbols
   * @returns string
   */
  makeResourceKey(filePath, symbols) {
    return `${filePath}?${symbols.join(',')}`;
  }
};
