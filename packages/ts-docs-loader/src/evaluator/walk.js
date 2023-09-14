/**
 * Recurse through every key of `obj`.
 *
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 *
 * @callback Recurser
 * @param {Node | Node[]} obj
 * @param {Key=} key
 *
 * @callback Walker
 * @param {Node} obj
 * @param {Key} key
 * @param {Recurser} recurse
 *
 * @type {(obj: any, walkerFn: Walker) => any}
 */
export function walk(obj, walkerFn) {
  // circular is to make sure we don't traverse over an object we visited earlier in the recursion
  const circular = new Set();

  /** @type {(obj: Node, k?: Key) => DocsResult}  */
  const visit = (obj, k = null) => {
    /** @type {Recurser} */
    const recurse = (obj, key = k) => {
      if (!Array.isArray(obj) && circular.has(obj)) {
        return {
          type: 'link',
          id: obj.id,
        };
      }

      if (Array.isArray(obj)) {
        const resultArray = [];
        obj.forEach((item, i) => (resultArray[i] = visit(item, key)));
        return resultArray;
      } else if (obj && typeof obj === 'object') {
        circular.add(obj);
        const res = {};
        for (const key in obj) {
          res[key] = visit(obj[key], key);
        }
        circular.delete(obj);
        return res;
      } else {
        return obj;
      }
    };

    return walkerFn(obj, k, recurse);
  };

  const res = {};
  for (const k in obj) {
    res[k] = visit(obj[k]);
  }

  return res;
}
