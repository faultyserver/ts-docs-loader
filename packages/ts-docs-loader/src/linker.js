// @ts-check

const mergeExtensions = require('./evaluator/extends');
const NodeResolver = require('./evaluator/nodeResolver');
const performOmit = require('./evaluator/omit');
const walk = require('./evaluator/walk');

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').TypeParameterNode} TypeParameterNode
 * @typedef {import('@faulty/ts-docs-node-types').PropertyNode | import('@faulty/ts-docs-node-types').MethodNode} PropertyOrMethodNode
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 *
 * @typedef {Record<string, Node>} LoaderOutput
 * @typedef {Record<string, Node>} DocsResult
 *
 * @typedef {Record<string, Node>} NodeMap
 */

/**
 * @param {Asset} thisAsset
 * @param {Record<string, Asset>} dependencies
 * @returns {{exports: DocsResult, links: Record<string, object>}}
 */
module.exports = class Linker {
  /** @type {NodeMap} */
  nodes = {};
  cache = new Map();

  /**
   * @param {Asset} thisAsset
   * @param {Record<string, Asset>} dependencies
   */
  constructor(thisAsset, dependencies) {
    this.asset = thisAsset;
    this.dependencies = dependencies;
    this.nodeResolver = new NodeResolver(this.nodes, this.dependencies);
  }

  /**
   * @returns {{exports: Record<string, Node>, links: Record<string, Node>, linksByExport: Record<string, string[]>}}
   */
  run() {
    // 2. Start processing at the entry point.
    /** @type {DocsResult | undefined} */
    let result;
    try {
      result = this.processAsset(this.asset);
    } catch (err) {
      console.log(err.stack);
      return {exports: {}, links: {}, linksByExport: {}};
    }

    // 6. Recursively walk all link nodes in the tree of exports to append them
    // to the links field for this asset.
    const {linksByExport, links} = this.walkLinks(result);

    return {exports: result, links, linksByExport};
  }

  /**
   *
   * @param {Asset} asset
   * @returns {DocsResult}
   */
  processAsset(asset) {
    if (this.cache.has(asset.id)) {
      return this.cache.get(asset.id);
    }

    /** @type {DocsResult} */
    const res = {};
    this.cache.set(asset.id, res);
    this._processAsset(asset, res);
    return res;
  }

  /**
   * Return the source asset of the given symbol and it's exported name there.
   *
   * @param {Asset} asset
   * @param {string} symbol
   * @returns {{asset: Asset, exportSymbol: string}}
   */
  getSymbolResolution(asset, symbol) {
    for (const [, dependency] of Object.entries(this.dependencies)) {
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
  _processAsset(asset, res) {
    // 3. Resolve all of the docs and references for this module.
    const obj = this.processCode(asset.exports);
    Object.assign(res, obj);

    // 4. For every symbol exported by this module, fully resolve it to a
    // presentable object. The function of this is appending all of the
    // referenced types from other files to the set of types defined locally.
    //
    // (symbols is an array of [exported, local] mappings, where `local` is the
    // name from the source, and `exported` is the aliased name).
    for (const [local, exported] of asset.symbols) {
      // Get the source module and exported name of the symbol.
      const {asset: resolvedAsset, exportSymbol} = this.getSymbolResolution(asset, local);
      // Get the processed module that the symbol comes from (either this module or the one resolved above)
      const processed = resolvedAsset.id === asset.id ? obj : this.processAsset(resolvedAsset);

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

    // 5. For every module that this module exports from on, if everything is
    // exported, recursively add those to the resolved set as well.
    for (const dep of Object.values(this.dependencies)) {
      const wildcard = dep.symbols.get('*');
      // Only need to process true wildcards here, since renamed wildcard
      // exports are handled as symbols of the asset itself, not just re-exports
      // of dependencies like unnamed wildcards are.
      if (wildcard === '*') {
        // Duplicate all of the exports from the dependency
        Object.assign(res, this.processAsset(dep));
      }
    }
  }

  ///
  // Everything below here is implementations supporting the above process.
  // No new processes happen below.
  ///

  /**
   * @param {DocsResult} nodes
   * @returns {{linksByExport: Record<string, string[]>, links: Record<string, Node>}}
   */
  walkLinks(nodes) {
    /** @type {Record<string, Node>} */
    const links = {};
    /** @type {Record<string, string[]>} */
    const linksByExport = {};

    /** @type {(id: string) => Node | undefined} */
    const saveLink = (id) => {
      const value = this.nodes[id] ?? this.nodeResolver.resolveLink(id);
      if (value == null) return;
      links[id] = value;
    };

    walk(nodes, (t, _k, recurse) => {
      if (t == null) return t;

      // don't follow the link if it's already in links, that's circular
      if (t.type === 'link' && links[t.id] == null) {
        saveLink(t.id);
        recurse(this.nodes[t.id]);
      } else if ((t.type === 'property' || t.type === 'method') && t.inheritedFrom != null) {
        saveLink(t.inheritedFrom);
      }

      return recurse(t);
    });

    return {linksByExport, links};
  }

  /**
   * Resolve all of the docs and references for the given module.
   *
   * @param {DocsResult} obj
   * @returns {DocsResult}
   */
  processCode(obj) {
    /** @type {Node[] | null} */
    let application = null;
    /** @type {Array<Record<string, Node>>} */
    const paramStack = [];
    /** @type {Array<string | null>} */
    const keyStack = [];

    return walk(obj, (current, key, recurse) => {
      if (current == null) return current;

      // Resolve references to imported names to the actual node they reference.
      if (current.type === 'reference') {
        const res = this.dependencies[current.specifier] ?? this.asset;
        const result = res?.exports[current.imported] ?? null;
        if (result != null) {
          current = result;
        } else {
          return {
            type: 'identifier',
            name: current.local,
          };
        }
      }

      if (current.type === 'application') {
        application = recurse(current.typeParameters, 'typeParameters');
      }

      // Gather type parameters from the interface/alias/component so they can
      // be applied to any descendants of the type.
      let hasParams = false;
      if (
        (current.type === 'alias' || current.type === 'interface') &&
        current.typeParameters &&
        application != null &&
        this.shouldMerge(current, key, keyStack)
      ) {
        const app = application;
        const params = Object.assign({}, paramStack[paramStack.length - 1]);
        current.typeParameters.forEach((p, i) => {
          params[p.name] = app[i] ?? p.default;
        });
        paramStack.push(params);
        // so we don't replace the type parameters in the extended interface
        application = null;
        hasParams = true;
      } else if (
        (current.type === 'alias' || current.type === 'interface' || current.type === 'component') &&
        current.typeParameters &&
        keyStack.length === 0
      ) {
        // If we are at a root export, replace type parameters with constraints if possible.
        // Seeing `DateValue` (as in `T extends DateValue`) is nicer than just `T`.
        const typeParameters = recurse(current.typeParameters, 'typeParameters');
        const params = Object.assign({}, paramStack[paramStack.length - 1]);
        /** @type {TypeParameterNode[]} */
        (typeParameters).forEach((p) => {
          if (!params[p.name] && p.constraint) {
            params[p.name] = p.constraint;
          }
        });
        paramStack.push(params);
        hasParams = true;
      }

      keyStack.push(key);
      current = recurse(current);
      keyStack.pop();

      if (hasParams) {
        paramStack.pop();
      }

      const params = paramStack[paramStack.length - 1];
      if (current.type === 'application') {
        application = null;
        if (key === 'props') {
          return current.base;
        }
      }

      // Resolve `Omit<Type, Keys>` structures.
      if (current.type === 'identifier' && current.name === 'Omit' && application) {
        return performOmit(this.nodeResolver, application[0], application[1]);
      }

      // If this is just an identifier and references a type parameter that is
      // currently known, return that type parameter instead.
      if (current.type === 'identifier' && params && params[current.name]) {
        return params[current.name];
      }

      // If this is an interface, try to merge all the properties from it's
      // base classes into a flat set.
      if (current.type === 'interface') {
        const merged = mergeExtensions(current);
        if (this.nodes[current.id] == null) {
          this.nodes[current.id] = merged;
        }

        if (this.shouldMerge(current, key, keyStack)) {
          return merged;
        }

        // Otherwise return a type link.
        return {
          type: 'link',
          id: current.id,
        };
      }

      // For aliases, if it's being used as a `props` parameter type, then
      // resolve it to the actual value so that component props have that
      // information available directly.
      if (current.type === 'alias') {
        if (key === 'props') {
          return current.value;
        }

        if (this.nodes[current.id] == null) {
          this.nodes[current.id] = current;
        }

        return {
          type: 'link',
          id: current.id,
        };
      }

      if (current.type === 'keyof') {
        if (current.keyof.type === 'interface') {
          return {
            type: 'union',
            elements: Object.keys(current.keyof.properties).map((key) => ({
              type: 'string',
              value: key,
            })),
          };
        }
      }

      return current;
    });
  }

  /**
   * Determine whether the interface of `t` should merge the properties of its
   * base types into itself for presentation.
   *
   * @param {Node | null} t - The type being considered
   * @param {string | null} k - The key of `t` in the parent object
   * @param {Array<string | null>} keyStack - the ancestry of keys to the root object being walked
   * @returns {boolean}
   */
  shouldMerge(t, k, keyStack) {
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
};
