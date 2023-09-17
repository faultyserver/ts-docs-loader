/**
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 */
module.exports = class NodeResolver {
  /**
   * @param {Record<string, Node>} nodes
   * @param {Record<string, Asset>} dependencies
   */
  constructor(nodes, dependencies) {
    /** @type {Record<string, Node>} */
    this.nodes = nodes;
    /** @type {Record<string, Asset>} */
    this.dependencies = dependencies;
  }

  /**
   * Attempt to find the source value for the link with the given id, either
   * within thisAsset or any of the provided dependencies.
   *
   * @param {string} id
   * @returns {Node | null}
   */
  resolveLink(id) {
    if (this.nodes[id] != null) {
      return this.nodes[id];
    }

    for (const [, dep] of Object.entries(this.dependencies)) {
      if (id in dep.links) {
        return dep.links[id];
      }
    }

    return null;
  }

  /**
   * Resolve all of the elements of a Union, traversing through links and type
   * aliases to create a flat list.
   *
   * @param {Node} base The base element being traversed (normally a union, or other node types when recursing)
   * @returns {Node[]}
   */
  resolveUnionElements(base) {
    // If this isn't a union, just return the base element directly.
    if (base.type !== 'union') return [base];

    return base.elements.flatMap((element) => {
      // The union can contain references to other unions, like:
      //  type Foo = 'a' | 'b';
      //  type Bar = Foo | 'c';
      // When resolving `Omit<T, Bar>`, `Foo` needs to be resolved to its
      // actual union type and then iterated.
      const resolved = this.resolveValue(element);
      // If the resolved value is a string, add it directly.
      if (resolved.type === 'string' && resolved.value) return resolved;
      // If it is _also_ a union, collect its elements as well.
      if (resolved.type === 'union') return this.resolveUnionElements(resolved);
      // Otherwise, just return the type
      return resolved;
    });
  }

  /**
   * Resolve `obj` to a real Node from the given set of nodes.
   * Links, applications, and aliases are all traversed.
   *
   * @param {Node} obj
   * @returns {Node}
   */
  resolveValue(obj) {
    if (obj.type === 'link') {
      const resolvedLink = this.resolveLink(obj.id);
      // If we don't know what the link points to, just return it.
      if (resolvedLink == null) return obj;
      return this.resolveValue(resolvedLink);
    }

    if (obj.type === 'application') {
      return this.resolveValue(obj.base);
    }

    if (obj.type === 'alias') {
      return this.resolveValue(obj.value);
    }

    return obj;
  }
};
