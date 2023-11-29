/**
 * @typedef {import('@faulty/ts-docs-node-types').PropertyNode | import('@faulty/ts-docs-node-types').MethodNode} PropertyOrMethodNode
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 */

/**
 * Attempt to flatten all of the properties from all of the extended types that
 * the interface extends into a single object.
 *
 * @param {Node} base
 * @returns {Node}
 */
module.exports = function mergeExtensions(base) {
  // If it's a proxy type, like a type alias or a generic type, just get the base type.
  if (base.type === 'application') {
    base = base.base;
  } else if (base.type === 'alias') {
    base = base.value;
  }

  /** @type {Record<string, PropertyOrMethodNode>} */
  const properties = {};
  const exts = [];

  if (base.type !== 'interface') {
    return base;
  }

  for (const ext of base.extends) {
    if (ext == null) {
      // temp workaround for ErrorBoundary extends React.Component which isn't being included right now for some reason
      console.log('ext should not be null', base);
      continue;
    }

    const merged = mergeExtensions(ext);
    if (merged.type === 'interface') {
      merge(properties, merged.properties, ext.id);
    } else {
      exts.push(merged);
    }
  }

  merge(properties, base.properties, base.id);

  return {
    type: 'interface',
    ...base,
    properties,
    // TODO: When all base classes were able to be resolved and merged, the
    // `extends` array will be empty. Maybe it could/should still populate for
    // additional information?
    extends: exts,
  };
};

/**
 * Merge all properties from `source` into `target`, but only if `target` does
 * not already have a key with the same name. `inheritedFrom` will be set to
 * the given id, unless the source node already has an inherited name set.
 *
 * @param {Record<string, PropertyOrMethodNode>} target
 * @param {Record<string, PropertyOrMethodNode>} source
 * @param {string=} inheritedFrom
 */
function merge(target, source, inheritedFrom) {
  for (const key in source) {
    target[key] = {
      inheritedFrom,
      ...source[key],
    };
  }
}
