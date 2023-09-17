// @ts-check

/**
 * @typedef {import('@babel/parser').ParseResult<import('@babel/types').File>} ProgramAST
 *
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 *
 * @typedef {import('./types').SourceExport} SourceExport
 * @typedef {import('./types').NodeId} NodeId
 *
 * @typedef CacheValue
 * @property {Node} node
 * @property {NodeId[]} links
 */

const util = require('./util');

/**
 * A cache that persists across loader requests to let the loader re-use
 * results of processing a file, even if the current request hasn't yet
 * processed it.
 *
 * Keys of the cache are unique symbol ids (an absolute file path and the name
 * of the symbol, joined by a colon). The value for each key is the Node that
 * the symbol represents and a list of linked node ids needed to fully display
 * the node's type information (e.g., references, value types, etc.).
 *
 * The loader checks this cache before attempting to resolve any symbols from
 * a file, and repopulates the cache with new values after resolving all of the
 * symbols that were missed in the first check.
 */
module.exports = class LoaderCache {
  /**
   * Map of symbol ids (file path + name) to their processed value.
   * Entries from the cache are always valid, and if all of the
   * linked dependencies can also be found in the cache, then no
   * additional processing is necessary.
   *
   * @type {Map<NodeId, CacheValue>}
   */
  symbolCache = new Map();

  /**
   * Map of files to the complete list of exported symbols from that file.
   * The list of symbols is itself a Record of symbol names to the full id of
   * the symbol.
   *
   * Entries in this map are exhaustive, meaning that if the entry exists,
   * the list includes _all_ exported symbols, including those re-exported
   * from dependencies. So, if an un-scoped request for all exports of a file
   * comes in, and all of the symbols mapped in this file are able to be found
   * in the cache, then no additional processing needs to occur.
   *
   * @type {Map<string, Map<string, SourceExport>>} */
  exportCache = new Map();

  /**
   * Map of absolute file paths to parsed ASTs, kept around since the loader
   * ends up doing multiple passes over a file
   *
   * @type {Map<string, ProgramAST>}
   */
  astCache = new Map();

  constructor() {}

  /**
   * @param {NodeId} nodeId
   */
  getCachedSymbol(nodeId) {
    return this.symbolCache.get(nodeId);
  }

  /**
   * Look up all of the requested symbols from the file, returning a map of
   * values that were found in the cache, along with a list of symbols that
   * were not found and will need to be resolved afterward.
   *
   * If `symbols` is undefined, then the full list of exports from the file
   * will be used instead.
   *
   * If the list of exports for the file doesn't exist, then no symbols
   * will be looked up and all will be considered unfound.
   *
   * @param {string} filePath
   * @param {string[] | undefined} symbols
   * @returns {{found: Record<string, CacheValue>, unfound: string[] | undefined}}
   */
  getCachedSymbolsFromFile(filePath, symbols) {
    const exportMap = this.getExportsFromFile(filePath);
    // If we don't know the exports of the file, we can't safely resolve
    // them from the symbol cache. In reality, this only happens when a
    // file has been invalidated.
    if (exportMap == null) return {found: {}, unfound: symbols};

    const requestedSymbols = symbols === undefined ? Object.keys(exportMap) : symbols;

    /** @type {Record<string, CacheValue>} */
    const found = {};
    const unfound = [];

    for (const symbol of requestedSymbols) {
      const exported = exportMap.get(symbol);
      // If the export map doesn't know about the symbol, then it can't be
      // found. This should never happen.
      if (exported == null) {
        unfound.push(symbol);
        continue;
      }

      const value = this.getCachedSymbol(exported.id);
      // If the result value for the id doesn't exist, then it's not cached
      // and will need to be processed.
      if (value == null) {
        unfound.push(symbol);
        continue;
      }

      found[symbol] = value;
    }

    return {found, unfound};
  }

  /**
   * @param {NodeId} id
   * @param {CacheValue} value
   */
  setSymbol(id, value) {
    this.symbolCache.set(id, value);
  }

  /**
   * @param {string} filePath
   * @param {string} symbol
   */
  deleteSymbol(filePath, symbol) {
    this.symbolCache.delete(util.makeId(filePath, symbol));
  }

  /**
   * Delete all of the cache entries for symbols from the given file.
   *
   * @param {string} filePath
   * @returns {string[]} List of deleted symbols
   */
  deleteSymbolsFromFile(filePath) {
    const deletedKeys = [];
    for (const id of this.symbolCache.keys()) {
      if (id.file === filePath) {
        this.symbolCache.delete(id);
        deletedKeys.push(id.symbol);
      }
    }

    return deletedKeys;
  }

  /**
   * Return the names of all symbols that the given file exports. Using the
   * name of a symbol exported by the file to look up an id from the returned
   * map, that id can then be resolved using `getCachedSymbol` to get the
   * actual value for the symbol.
   *
   * If the cache does not know all of the symbols that a file exports, this
   * method will return undefined. Values exported by the file may still exist
   * in the cache, but because the list is not known to be exhaustive, this
   * method cannot safely return a list.
   *
   * @param {string} filePath
   * @returns {Map<string, SourceExport> | undefined}
   */
  getExportsFromFile(filePath) {
    return this.exportCache.get(filePath);
  }

  /**
   * Get the originating source export for a single as it is exported from
   * the given file.
   *
   * @param {string} filePath
   * @param {string} symbol
   * @returns {SourceExport | undefined}
   */
  getExportFromFile(filePath, symbol) {
    const exportMap = this.getExportsFromFile(filePath);
    return exportMap?.get(symbol);
  }

  /**
   * Set the record of all known exports for the given file, mapping the name
   * of an exported symbol to its full id (which could be from another file).
   *
   * @param {string} filePath
   * @param {Map<string, SourceExport>} symbolMap
   */
  setExportsFromFile(filePath, symbolMap) {
    this.exportCache.set(filePath, symbolMap);
  }

  /**
   * @param {string} filePath
   * @returns {ProgramAST | undefined}
   */
  getAST(filePath) {
    return this.astCache.get(filePath);
  }

  /**
   * @param {string} filePath
   * @param {ProgramAST} ast
   */
  setAST(filePath, ast) {
    this.astCache.set(filePath, ast);
  }

  /**
   * When a file gets invalidated for any reason, we cannot be confident that
   * the list of its exports has not changed, neither the actual values of each
   * export (e.g., a type changes), nor the complete list of exports (e.g., a
   * new exported symbol is added).
   *
   * In that case, the file must be invalidated, which clears the symbol cache,
   * the export cache for that file, and the cached AST.
   *
   * Note that any re-exported values from other files are not deleted from the
   * symbol cache, since they would not have changed by a change from this file.
   *
   * @param {string} filePath
   */
  invalidateFile(filePath) {
    this.exportCache.delete(filePath);
    this.deleteSymbolsFromFile(filePath);
    this.astCache.delete(filePath);
  }
};
