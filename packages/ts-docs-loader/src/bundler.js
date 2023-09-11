/* eslint-disable no-console, no-use-before-define */
// @ts-check

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').PropertyNode | import('@faulty/ts-docs-node-types').MethodNode} PropertyOrMethodNode
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 */

/**
 * @typedef {Record<string, Node>} LoaderOutput
 * @typedef {Record<string, Node>} DocsResult
 * @typedef {string | null} Key
 * @property {string} type
 *
 * @typedef {Record<string, Node>} NodeMap
 */

/**
 * @param {Asset} thisAsset
 * @param {Record<string, Asset>} dependencies
 * @returns {{exports: DocsResult, links: Record<string, object>}}
 */
module.exports = function bundle(thisAsset, dependencies) {
  /** @type {NodeMap} */
  const nodes = {};

  const cache = new Map();

  /**
   * Print messages only under certain conditions (like for specific assets) to
   * reduce noise when bundling large numbers of files.
   *
   * @param {any[]} args
   * @param {RegExp} filePattern
   */
  // @ts-ignore
  // eslint-disable-next-line
  function debugOnly(args, filePattern = /$/) {
    if (filePattern.test(thisAsset.id)) {
      console.log(...args);
    }
  }

  /**
   *
   * @param {Asset} asset
   * @returns {DocsResult}
   */
  function processAsset(asset) {
    if (cache.has(asset.id)) {
      return cache.get(asset.id);
    }

    /** @type {DocsResult} */
    const res = {};
    cache.set(asset.id, res);
    _processAsset(asset, res);
    return res;
  }

  // 2. Start processing at the entry point.
  /** @type {DocsResult | undefined} */
  let result;
  try {
    result = processAsset(thisAsset);
  } catch (err) {
    console.log(err.stack);
    return {exports: {}, links: {}};
  }

  /**
   * Return the source asset of the given symbol and it's exported name there.
   *
   * @param {Asset} asset
   * @param {string} symbol
   * @returns {{asset: Asset, exportSymbol: string}}
   */
  function getSymbolResolution(asset, symbol) {
    for (const [, dependency] of Object.entries(dependencies)) {
      const exportSymbol = dependency.symbols.get(symbol);
      if (exportSymbol != null) {
        return {asset: dependency, exportSymbol};
      }
    }
    return {asset, exportSymbol: symbol};
  }

  /**
   * Walk through the module, adding all of the information from its
   * dependencies to `res`.
   *
   * @param {Asset} asset
   * @param {DocsResult} res
   */
  function _processAsset(asset, res) {
    // 3. Resolve all of the docs and references for this module.
    const obj = processCode(asset.exports);
    Object.assign(res, obj);

    // 4. For every symbol exported by this module, fully resolve it to a
    // presentable object. The function of this is appending all of the
    // referenced types from other files to the set of types defined locally.
    //
    // (symbols is an array of [source, local] mappings, where `source` is the
    // name from the source, and `local` is the aliased name).
    for (const [exported] of asset.symbols) {
      // Get the source module and exported name of the symbol.
      const {asset: resolvedAsset, exportSymbol} = getSymbolResolution(asset, exported);
      // Get the processed module that the symbol comes from (either this module or the one resolved above)
      const processed = resolvedAsset.id === asset.id ? obj : processAsset(resolvedAsset);

      // If it's an export-all declaration, just copy all the entities from the module.
      if (exportSymbol === '*') {
        Object.assign(res, processed);
      } else {
        // If it's a renamed export, copy the information from the source
        // module and just give it a new name.
        // (e.g. export {useGridCell as useTableCell})
        if (exportSymbol !== exported) {
          if (processed[exportSymbol] == null) {
            console.log('trying to get exported symbol `', exportSymbol, '` but did not exist in `', resolvedAsset.id);
          }
          const clone = {...processed[exportSymbol]};
          clone.name = exported;
          res[exported] = clone;
          // If it's not renamed, just directly assign it.
        } else {
          res[exported] = processed[exportSymbol];
        }
      }
    }

    // 5. For every module that this module depends on, if it also exports
    // everything from one of its sources, then recursively add those to
    // the resolved set as well.
    for (const [, dep] of Object.entries(dependencies)) {
      const wildcard = dep.symbols.get('*');
      // ? only checking if it's exported without a namespace.
      if (wildcard === '*') {
        // Duplicate all of the exports from the dependency
        Object.assign(res, processAsset(dep));
      }
    }
  }

  // 6. Recursively walk all link nodes in the tree of exports to append them
  // to the links field for this asset.
  const links = {};
  walkLinks(result);

  ///
  // Everything below here is implementations supporting the above process.
  // No new processes happen below.
  ///

  /**
   * Attempt to find the source value for the link with the given id, either
   * within thisAsset or any of the provided dependencies.
   *
   * @param {string} id
   * @returns {Node | null}
   */
  function resolveLink(id) {
    if (nodes[id] != null) {
      return nodes[id];
    }

    for (const [, dep] of Object.entries(dependencies)) {
      if (id in dep.links) {
        return dep.links[id];
      }
    }

    return null;
  }

  /**
   * @param {DocsResult | Node} obj
   */
  function walkLinks(obj) {
    /**
     * @param {string} id
     */
    function saveLink(id) {
      // If the link is to a node that exists locally, use that
      if (nodes[id] != null) {
        links[id] = nodes[id];
        // Otherwise check if the link is to a dependency
      } else {
        const linkValue = resolveLink(id);
        if (linkValue != null) {
          links[id] = linkValue;
        }
      }
    }
    walk(obj, (t, _k, recurse) => {
      // don't follow the link if it's already in links, that's circular
      if (t != null && t.type === 'link' && links[t.id] == null) {
        saveLink(t.id);
        walkLinks(nodes[t.id]);
      } else if (t != null && (t.type === 'property' || t.type === 'method') && t.inheritedFrom != null) {
        saveLink(t.inheritedFrom);
      }

      return recurse(t);
    });
  }

  /**
   * Resolve all of the docs and references for the given module.
   *
   * @param {DocsResult} obj
   * @returns {DocsResult}
   */
  function processCode(obj) {
    let application;
    const paramStack = [];
    const keyStack = [];
    // Recurse through
    return walk(obj, (t, k, recurse) => {
      // Resolve references to imported names to the actual node they reference.
      if (t && t.type === 'reference') {
        // Save as a local to keep type refinement.
        const node = t;
        const res = dependencies[node.specifier] ?? thisAsset;
        const result = res?.exports[t.imported] ?? null;
        if (result != null) {
          t = result;
        } else {
          return {
            type: 'identifier',
            name: t.local,
          };
        }
      }

      if (t && t.type === 'application') {
        application = recurse(t.typeParameters, 'typeParameters');
      }

      // Gather type parameters from the interface/alias/component so they can
      // be applied to any descendants of the type.
      let hasParams = false;
      if (
        t &&
        (t.type === 'alias' || t.type === 'interface') &&
        t.typeParameters &&
        application &&
        shouldMerge(t, k, keyStack)
      ) {
        const params = Object.assign({}, paramStack[paramStack.length - 1]);
        t.typeParameters.forEach((p, i) => {
          params[p.name] = application[i] || p.default;
        });
        paramStack.push(params);
        // so we don't replace the type parameters in the extended interface
        application = null;
        hasParams = true;
      } else if (
        t &&
        (t.type === 'alias' || t.type === 'interface' || t.type === 'component') &&
        t.typeParameters &&
        keyStack.length === 0
      ) {
        // If we are at a root export, replace type parameters with constraints if possible.
        // Seeing `DateValue` (as in `T extends DateValue`) is nicer than just `T`.
        const typeParameters = recurse(t.typeParameters, 'typeParameters');
        const params = Object.assign({}, paramStack[paramStack.length - 1]);
        typeParameters.forEach((p) => {
          if (!params[p.name] && p.constraint) {
            params[p.name] = p.constraint;
          }
        });
        paramStack.push(params);
        hasParams = true;
      }

      keyStack.push(k);
      t = recurse(t);
      keyStack.pop();

      if (hasParams) {
        paramStack.pop();
      }

      const params = paramStack[paramStack.length - 1];
      if (t && t.type === 'application') {
        application = null;
        if (k === 'props') {
          return t.base;
        }
      }

      // If this is an Omit<Type, keys> structure, perform the omit and return
      // the result.
      if (t && t.type === 'identifier' && t.name === 'Omit' && application) {
        return omit(application[0], application[1]);
      }

      // If this is just an identifier and references a type parameter that is
      // currently known, return that type parameter instead.
      if (t && t.type === 'identifier' && params && params[t.name]) {
        return params[t.name];
      }

      // If this is an interface, try to merge all the properties from it's
      // base classes into a flat set.
      if (t && t.type === 'interface') {
        const merged = mergeInterface(t);
        if (nodes[t.id] == null) {
          nodes[t.id] = merged;
        }

        if (shouldMerge(t, k, keyStack)) {
          return merged;
        }

        // Otherwise return a type link.
        return {
          type: 'link',
          id: t.id,
        };
      }

      // For aliases, if it's being used as a `props` parameter type, then
      // resolve it to the actual value so that component props have that
      // information available directly.
      if (t && t.type === 'alias') {
        if (k === 'props') {
          return t.value;
        }

        if (nodes[t.id] == null) {
          nodes[t.id] = t;
        }

        return {
          type: 'link',
          id: t.id,
        };
      }

      if (t && t.type === 'keyof') {
        if (t.keyof.type === 'interface') {
          return {
            type: 'union',
            elements: Object.keys(t.keyof.properties).map((key) => ({
              type: 'string',
              value: key,
            })),
          };
        }
      }

      return t;
    });
  }

  /**
   * Determine whether the interface of `t` should merge the properties of its
   * base types into itself for presentation.
   *
   * @param {Node | null} t - The type being considered
   * @param {Key} k - The key of `t` in the parent object
   * @param {Key[]} keyStack - the ancestry of keys to the root object being walked
   * @returns {boolean}
   */
  function shouldMerge(t, k, keyStack) {
    if (t && (t.type === 'alias' || t.type === 'interface')) {
      // Return merged interface if the parent is a component or an interface we're extending.
      if (t.type === 'interface' && (!k || k === 'props' || k === 'extends' || k === 'keyof')) {
        return true;
      }

      // If the key is "base", then it came from a generic type application, so we need to
      // check one level above. If that was a component or extended interface, return the
      // merged interface.
      const lastKey = keyStack[keyStack.length - 1];
      if (k === 'base' && (lastKey === 'props' || lastKey === 'extends')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recurse through every key of `obj`
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
  function walk(obj, walkerFn) {
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

  /**
   * Flatten all of the properties from all of the base classes that the interface
   * extends into a single object.
   *
   * @param {Node} obj
   * @returns {Node}
   */
  function mergeInterface(obj) {
    if (obj.type === 'application') {
      obj = obj.base;
    } else if (obj.type === 'alias') {
      obj = obj.value;
    }

    /** @type {Record<string, PropertyOrMethodNode>} */
    const properties = {};
    const exts = [];

    if (obj.type !== 'interface') {
      return obj;
    }

    for (const ext of obj.extends) {
      if (ext == null) {
        // temp workaround for ErrorBoundary extends React.Component which isn't being included right now for some reason
        console.log('ext should not be null', obj);
        continue;
      }

      const merged = mergeInterface(ext);
      if (merged.type === 'interface') {
        merge(properties, merged.properties, ext.id);
      } else {
        exts.push(merged);
      }
    }

    merge(properties, obj.properties, obj.id);

    return {
      type: 'interface',
      id: obj.id,
      name: obj.name,
      properties,
      typeParameters: obj.typeParameters,
      // TODO: When all base classes were able to be resolved and merged, the
      // `extends` array will be empty. Maybe it could/should still populate for
      // additional information?
      extends: exts,
      description: obj.description,
    };
  }

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

  /**
   * Perform TypeScript's `Omit` utility, removing the properties `toOmit` from `obj`.
   *
   * @param {Node} obj
   * @param {Node} toOmit
   * @returns
   */
  function omit(obj, toOmit) {
    obj = resolveValue(obj);
    toOmit = resolveValue(toOmit);

    if (obj.type === 'interface' || obj.type === 'object') {
      const omittedKeys = new Set();
      // If the omitted value is just a single string, add it directly
      if (toOmit.type === 'string' && toOmit.value) {
        omittedKeys.add(toOmit.value);
        // If it's a union, resolve all of the elements of that union and then
        // add them to the omitted set.
      } else if (toOmit.type === 'union') {
        const elements = resolveUnionElements(toOmit);
        for (const element of elements) {
          if (element.type === 'string' && element.value != null) {
            omittedKeys.add(element.value);
          }
        }
      }

      if (omittedKeys.size === 0) {
        return obj;
      }

      const properties = {};
      for (const key in obj.properties) {
        if (!omittedKeys.has(key)) {
          properties[key] = obj.properties[key];
        }
      }

      return {
        ...obj,
        properties,
      };
    }

    return obj;
  }

  /**
   * Resolve all of the elements of a Union, traversing through links and type
   * aliases to create a flat list.
   *
   * @param {Node} base The base element being traversed (normally a union, or other node types when recursing)
   * @returns {Node[]}
   */
  function resolveUnionElements(base) {
    // If this isn't a union, just return the base element directly.
    if (base.type !== 'union') return [base];

    return base.elements.flatMap((element) => {
      // The union can contain references to other unions, like:
      //  type Foo = 'a' | 'b';
      //  type Bar = Foo | 'c';
      // When resolving `Omit<T, Bar>`, `Foo` needs to be resolved to its
      // actual union type and then iterated.
      const resolved = resolveValue(element);
      // If the resolved value is a string, add it directly.
      if (resolved.type === 'string' && resolved.value) return resolved;
      // If it is _also_ a union, collect its elements as well.
      if (resolved.type === 'union') return resolveUnionElements(resolved);
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
  function resolveValue(obj) {
    if (obj.type === 'link') {
      const resolvedLink = resolveLink(obj.id);
      // If we don't know what the link points to, just return it.
      if (resolvedLink == null) return obj;
      return resolveValue(resolvedLink);
    }

    if (obj.type === 'application') {
      return resolveValue(obj.base);
    }

    if (obj.type === 'alias') {
      return resolveValue(obj.value);
    }

    return obj;
  }

  return {exports: result, links};
};
