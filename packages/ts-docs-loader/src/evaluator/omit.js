/** @typedef {import('@faulty/ts-docs-node-types').Node} Node */
/** @typedef {import('../packager').Packager} Packager */

import Packager from '../packager';

const OMITTABLE_TYPES = ['interface', 'object'];

/**
 * Perform TypeScript's `Omit` utility, removing the properties named by `toOmit` from `base`.
 *
 * @param {Packager} packager
 * @param {Node} base
 * @param {Node} toOmit
 * @returns {Node}
 */
export function performOmit(packager, base, toOmit) {
  base = packager.resolveValue(base);
  toOmit = packager.resolveValue(toOmit);

  if (!OMITTABLE_TYPES.includes(base.type)) return base;

  const keys = new Set();
  // If the omitted value is just a single string, add it directly
  if (toOmit.type === 'string' && toOmit.value) {
    keys.add(toOmit.value);
    // If it's a union, resolve all of the elements of that union and then
    // add them to the omitted set.
  } else if (toOmit.type === 'union') {
    const elements = packager.resolveUnionElements(toOmit);
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
}
