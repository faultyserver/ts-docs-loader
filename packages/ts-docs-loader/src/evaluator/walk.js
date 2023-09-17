/**
 * Recurse through every key of `obj`.
 *
 * @type {import('./types').walk}
 */
module.exports = function walk(object, walkerFn) {
  // circular is to make sure we don't traverse over an object we visited earlier in the recursion
  const circular = new Set();

  const visit = (obj, k = null) => {
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
  for (const k in object) {
    res[k] = visit(object[k]);
  }

  return res;
};
