// @ts-check

/**
 * @typedef {import('./types').NodeId} NodeId
 */

module.exports.groupBy =
  /**
   * @function
   * @template T
   * @param {Iterable<T>} iterable
   * @param {(element: T) => string} keyerFn
   * @returns {Record<string, T[]>}
   */
  function groupBy(iterable, keyerFn) {
    /** @type {Record<string, T[]>} */
    const result = {};
    for (const element of iterable) {
      let key = keyerFn(element);
      result[key] = result[key] ?? [];
      result[key].push(element);
    }

    return result;
  };

module.exports.makeId =
  /**
   * Return a NodeId for the given symbol coming from the given file.
   *
   * @param {string} file
   * @param {string} symbol
   * @returns {NodeId}
   */
  function makeId(file, symbol) {
    return {file, symbol};
  };

module.exports.makeIdString =
  /**
   * Return a string for the given symbol coming from the given file.
   *
   * @param {string} file
   * @param {string} symbol
   * @returns {string}
   */
  function makeIdString(file, symbol) {
    return `${file}:${symbol}`;
  };

module.exports.parseId =
  /**
   * Return a NodeId from the serialized representation
   *
   * @param {string} idString
   * @returns {NodeId}
   */
  function parseId(idString) {
    const [file, symbol] = idString.split(':');
    return {file, symbol};
  };

module.exports.idToString =
  /**
   * Return a serialized string for the NodeId.
   *
   * @param {NodeId} id
   * @returns {string}
   */
  function idToString(id) {
    return `${id.file}:${id.symbol}`;
  };
