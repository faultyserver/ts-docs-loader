/**
 * Recurse through every key of `object`, invoking `walkerFn` with the value of
 * that key and the key itself, then using the return value from each key to
 * build a new object. The end result is a new object with all of the elements
 * mapped to new values by the walker function.
 *
 * @type {import('./types').walk}
 */
module.exports = function walk(object, walkerFn) {
  // circular is to make sure we don't traverse over an object we visited earlier in the recursion
  const circular = new Set();

  function visit(current, k = null) {
    /** @type {import ('./types').Recurser} */
    function recurse(subject, key = k) {
      if (!Array.isArray(subject) && circular.has(subject)) {
        return {
          type: 'link',
          id: subject.id,
        };
      }

      if (Array.isArray(subject)) {
        const resultArray = [];
        subject.forEach((item, i) => (resultArray[i] = visit(item, key)));
        return resultArray;
      } else if (subject && typeof subject === 'object') {
        circular.add(subject);
        const res = {};
        for (const key in subject) {
          res[key] = visit(subject[key], key);
        }
        circular.delete(subject);
        return res;
      } else {
        return subject;
      }
    }

    return walkerFn(current, k, recurse);
  }

  const res = {};
  for (const k in object) {
    res[k] = visit(object[k]);
  }

  return res;
};
