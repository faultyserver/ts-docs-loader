/** @typedef {import('@faulty/ts-docs-node-types').Node} Node */
/** @typedef {import('../linker').Linker} Linker */

const OMITTABLE_TYPES = ['interface', 'object'];

/**
 * Perform TypeScript's `Omit` utility, removing the properties named by `toOmit` from `base`.
 *
 * @param {Linker} linker
 * @param {Node} base
 * @param {Node} toOmit
 * @returns {Node}
 */
module.exports = function performOmit(linker, base, toOmit) {
  base = linker.resolveValue(base);
  toOmit = linker.resolveValue(toOmit);

  if (!OMITTABLE_TYPES.includes(base.type)) return base;

  const keys = new Set();
  // If the omitted value is just a single string, add it directly
  if (toOmit.type === 'string' && toOmit.value) {
    keys.add(toOmit.value);
    // If it's a union, resolve all of the elements of that union and then
    // add them to the omitted set.
  } else if (toOmit.type === 'union') {
    const elements = linker.resolveUnionElements(toOmit);
    for (const element of elements) {
      if (element.type === 'string' && element.value != null) {
        keys.add(element.value);
      }
    }
  }

  // No keys to omit, so just return the object.
  if (keys.size === 0) return base;

  // Make a new object by iterating the base and
  const properties = {};
  for (const key in base.properties) {
    if (keys.has(key)) continue;

    properties[key] = base.properties[key];
  }

  return {
    ...base,
    properties,
  };
};
