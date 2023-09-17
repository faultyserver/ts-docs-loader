// @ts-check
const babel = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const Linker = require('./linker');
const Transformer = require('./transformer');
const util = require('./util');
const {getTypeBinding} = require('./typeScopes');

/**
 * @typedef {import('@babel/traverse').NodePath} NodePath
 *
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 *
 * @typedef {import('./types').SymbolExport} SymbolExport
 * @typedef {import('./types').NamespaceExport} NamespaceExport
 * @typedef {import('./types').ExternalExport} ExternalExport
 * @typedef {import('./types').WildcardExport} WildcardExport
 * @typedef {import('./types').Export} Export
 * @typedef {import('./types').NamedExport} NamedExport
 * @typedef {import('./types').SourceExport} SourceExport
 * @typedef {import('./types').SymbolImport} SymbolImport
 * @typedef {import('./types').Import} Import
 *
 * @typedef {import('./cache').NodeId} NodeId
 * @typedef {import('./transformer').Dependency} Dependency
 * @typedef {{exports: Record<string, Node>, links: Record<string, Node>}} LoadResult
 *
 * @typedef TransformResult
 * @property {Record<string, Node>} exportedNodes
 * @property {Dependency[]} importDependencies
 * @property {Map<string, string>} symbols
 *
 * @typedef Host
 * @property {(filePath: string) => Promise<string>} getSource Get the string content of the given file.
 * @property {(specifier: string, context: string) => Promise<string>} resolve Resolve an import specifier path to a file path.
 * @property {import('./cache')} cache
 */

module.exports = class Loader {
  /**
   * Set containing all files that are currently being processed by the loader,
   * as a naive way of dealing with circular dependencies.
   *
   * @type {Set<string>}
   */
  inProgress = new Set();

  /** @param {Host} host An adapter to the host bundler to load code and resolve module dependencies. */
  constructor(host) {
    /** @type {Host} */
    this.host = host;
  }

  /**
   * This is the main loop of the loader. It takes in the raw source code of a
   * module, parses it, transforms the content into a documentation node tree,
   * then recurses through all of the found dependencies to get their content,
   * and finally links all of the data from the module and its dependencies
   * into a single result.
   *
   * If `symbols` is given, only those symbols will be processed and returned,
   * allowing for granular traversal of dependencies and helping to avoid many
   * circular dependency problems. Otherwise, all symbols defined in the asset
   * will be processed.
   *
   * @type {(filePath: string, requestedSymbols?: string[]) => Promise<LoadResult>}
   */
  async load(filePath, requestedSymbols) {
    const start = performance.now();
    const thisResourceId = JSON.stringify({filePath});
    this.inProgress.add(thisResourceId);

    /** @type {LoadResult['exports']} */
    const exports = {};
    /** @type {LoadResult['links']} */
    const links = {};

    // Step 1: Load as much as possible from the cache.
    const {found, unfoundSymbols, unfoundLinks} = this.loadCachedSymbols(filePath, requestedSymbols);
    Object.assign(exports, found.exports);
    Object.assign(links, found.links);

    // Step 2: If everything was found, then just return the cached results.
    if (unfoundSymbols != null && unfoundSymbols.length === 0 && unfoundLinks.length === 0) {
      return {exports, links};
    }

    // Step 3a: Resolve the actual set of unfound symbols. `unfoundSymbols` can
    // only be undefined if the requested symbol set was blank (asking for all
    // exports) _and_ the export map for the file isn't known, so we need to
    // build that graph to get the set of exports.
    // If `unfoundSymbols` is anything other than defined, then we already know
    // the export map and can just use those symbols as the source of truth.
    const neededExports = await this.determineNeededExports(filePath, requestedSymbols, unfoundSymbols);

    // Step 3b: If any symbols weren't found, dispatch load requests for those symbols
    // and then merge the results into this module's result.
    const exportsByFile = util.groupBy(neededExports, (source) => source.id.file);
    for (const [file, exported] of Object.entries(exportsByFile)) {
      const dependencySymbols = await this._loadExports(file, exported);
      Object.assign(exports, dependencySymbols.exports);
      Object.assign(links, dependencySymbols.links);
    }

    // // Step 4: If any links weren't found, do the same thing, but only add the
    // // results as link values.
    // const linksByFile = util.groupBy(unfoundLinks, (id) => id.file);
    // for (const [file, ids] of Object.entries(linksByFile)) {
    //   const dependencySymbols = await this._loadExports(
    //     file,
    //     ids.map((id) => id.symbol),
    //   );
    //   Object.assign(links, dependencySymbols.exports);
    //   Object.assign(links, dependencySymbols.links);
    // }

    // Step 5: Now, everything has been found, so return the accumulated results
    this.inProgress.delete(thisResourceId);

    return {exports, links};
  }

  /**
   * Return the full set of symbols that have not yet been found and need to
   * be processed to satisfy the request for the given file.
   *
   * Returns the set of source exports matching the unfulfilled symbols for
   * the request.
   *
   * @param {string} filePath
   * @param {string[] | undefined} requestedSymbols
   * @param {string[] | undefined} unfoundSymbols
   *
   * @returns {Promise<SourceExport[]>}
   */
  async determineNeededExports(filePath, requestedSymbols, unfoundSymbols) {
    const sourceExports = await this.buildExportGraph(filePath);

    // `unfoundSymbols` should only be undefined if the requested symbol set
    // was blank (asking for all exports) _and_ the export map for the file
    // isn't known, so we need to build that graph to get the set of exports.
    if (unfoundSymbols == null) {
      unfoundSymbols = Array.from(sourceExports.keys()).filter(
        (symbol) => requestedSymbols == null || requestedSymbols.includes(symbol),
      );
    }

    /** @type {SourceExport[]} */
    const neededExports = [];
    for (const symbol of unfoundSymbols) {
      const exported = sourceExports.get(symbol);
      if (exported == null) continue;

      neededExports.push(exported);
    }

    return neededExports;
  }

  /**
   * Process the requested exports from the file. It is a pre-condition of this
   * method that all of the requested exports are sourced from this file,
   * otherwise they will not be found.
   *
   * @type {(filePath: string, requestedExports: SourceExport[]) => Promise<LoadResult>}
   */
  async _loadExports(filePath, requestedExports) {
    const result = await this.processExports(filePath, requestedExports);
    // The iteration in `load` handles finding all of the dependent files that
    // exported symbols originate from, but those exports themselves may also
    // have dependencies to other files, through imports that are not themselves
    // re-exported. This recurstion loads all of those dependencies so that they
    // can be merged and linked for the final result.
    const resolvedDependencies = await this.recurseImportedDependencies(result.importDependencies, filePath);

    // TODO: Rewrite the linker? Or at least extract the `walkLinks` part?
    const thisAsset = {id: filePath, exports: result.exportedNodes, symbols: result.symbols, links: {}};
    const linked = new Linker(thisAsset, resolvedDependencies).run();

    // // TODO: Populate the cache with the created nodes once links can be attributed per-symbol.
    // for (const [exportName, node] of Object.entries(linked.exports)) {
    //   if (node.id == null) continue;
    //   this.host.cache.setSymbol(util.parseId(node.id), {node, linkIds: linked.linksByExport[exportName] ?? []});
    // }

    return linked;
  }

  /**
   * For each requested export, process it with the transformer to create
   * documentation nodes. Returns a map of the processed exports and a list
   * of additional dependencies that came from imports referenced by the
   * exported symbols.
   *
   * @param {string} filePath
   * @param {SourceExport[]} requestedExports
   * @returns {Promise<TransformResult>}
   */
  async processExports(filePath, requestedExports) {
    const transformer = new Transformer(filePath);
    /** @type {Record<string, Node>} */
    const exportedNodes = {};

    // TODO: Can this be removed?
    /** @type {Map<string, string>} */
    const symbols = new Map();

    for (const exp of requestedExports) {
      const node = transformer.processExport(exp.path);
      exportedNodes[exp.name] = node;
      symbols.set(exp.name, exp.name);
    }

    return {exportedNodes, symbols, importDependencies: transformer.dependencies};
  }

  /**
   * @param {Dependency[]} importDependencies
   * @param {string} thisFilePath
   * @returns {Promise<Record<string, Asset>>}
   */
  async recurseImportedDependencies(importDependencies, thisFilePath) {
    /** @type {Record<string, Asset>} */
    const resolvedDependencies = {};
    for (const dependency of importDependencies) {
      // If somehow the dependency exists but there aren't any symbols, it can
      // be skipped entirely.
      if (dependency.symbols.length === 0) continue;

      const resolvedPath = await this.host.resolve(dependency.source, thisFilePath);
      /** @type {string[] | undefined} */
      const requestedSymbols =
        // If there's a namespace in the list of requested symbols, then we need
        // to resolve all of them, so the requestedSymbols can/should be blank.
        dependency.symbols.some(({type}) => type === 'namespace')
          ? undefined
          : dependency.symbols
              .filter(({type}) => type === 'symbol')
              .map(
                (imp) =>
                  // @ts-expect-error imp is definitely a SourceImport here
                  imp.sourceName,
              );

      // TODO: Is this needed anymore with the way export name resolution happens?
      //
      // Really naive circular dependencies atm. Just returning a blank result
      // if the requested file is already in progress. Using `requestedSymbols`
      // here helps reduce instances of this, but still would be good to create
      // a stubbed instance or something so that links are at least resolved.
      if (this.inProgress.has(JSON.stringify({filePath: resolvedPath}))) {
        resolvedDependencies[dependency.source] = {
          id: resolvedPath,
          exports: {},
          links: {},
          symbols: new Map(),
        };
        continue;
      }

      // TODO: Remap imports to their local names so they can be linked
      const data = await this.load(resolvedPath, requestedSymbols);

      const depSymbols = new Map(
        dependency.symbols.map((imp) => {
          switch (imp.type) {
            case 'namespace':
              return [imp.localName, '*'];
            case 'default':
              return [imp.localName, '@default'];
            case 'symbol':
              return [imp.localName, imp.sourceName];
          }
        }),
      );

      resolvedDependencies[dependency.source] = {
        id: resolvedPath,
        exports: data.exports,
        links: data.links,
        symbols: depSymbols,
      };
    }

    return resolvedDependencies;
  }

  /**
   * Load all of the cached exports and links for the requested file symbols.
   * Any symbols that were not found in the cache will be listed in
   * `unfoundSymbols`, and any links will be in `unfoundLinks`.
   *
   * If the list of unfound symbols cannot be known (e.g., the file hasn't been
   * scanned for exports yet), `unfoundSymbols` will be set to Unknown.
   *
   * @type {(filePath: string, symbols?: string[]) => {found: LoadResult, unfoundSymbols: string[] | undefined, unfoundLinks: NodeId[]}}
   */
  loadCachedSymbols(filePath, symbols) {
    /** @type {LoadResult['exports']} */
    const exports = {};
    /** @type {LoadResult['links']} */
    const links = {};

    /** @type {Set<string>} */
    const linksToSearch = new Set();

    const {found: cachedSymbols, unfound} = this.host.cache.getCachedSymbolsFromFile(filePath, symbols);
    // If symbols were found _and_ no symbols were _not_ found, then it must be
    // safe to use all of the cached symbols to create the result.
    for (const [symbol, {node, linkIds}] of Object.entries(cachedSymbols)) {
      exports[symbol] = node;
      for (const link of linkIds) linksToSearch.add(link);
    }

    const unfoundLinks = [];
    for (const link of linksToSearch) {
      const cached = this.host.cache.getCachedSymbol(util.parseId(link));
      if (cached != null) {
        links[link] = cached.node;
      } else {
        unfoundLinks.push(util.parseId(link));
      }
    }

    return {found: {exports, links}, unfoundSymbols: unfound, unfoundLinks};
  }

  /**
   * Return a parsed AST of the source code for the given file. Right now this
   * is dependent on it being a babel-compatible AST that handles TypeScript.
   *
   * @param {string} filePath
   * @returns {Promise<import('@babel/parser').ParseResult<import('@babel/types').File>>}
   */
  async parse(filePath) {
    const cached = this.host.cache.getAST(filePath);
    if (cached) return cached;

    const isAmbient = filePath.endsWith('.d.ts');

    const source = await this.host.getSource(filePath);
    const result = babel.parse(source, {
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
      plugins: [
        'classProperties',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'dynamicImport',
        ['typescript', {dts: isAmbient}],
        'jsx',
        'classPrivateProperties',
        'classPrivateMethods',
      ],
    });

    this.host.cache.setAST(filePath, result);
    return result;
  }

  /**
   * Traverse the AST and collect the names of all of the symbols that are
   * exported. `sourceExports` is the set of symbols originating from the
   * file as exports (including namespace exports like `* as Foo`),
   * `externalExports` is a map of file paths to the list symbols being
   * exported from that file, and  `wildcardExports` is the list of unnamed
   * proxy exports from other files.
   *
   * Wildcard exports can't be resolved statically and require traversing the
   * source to determine all of the symbols being proxied.
   *
   * @param {string} filePath
   * @returns {Promise<{sourceExports: Map<string, SourceExport>, externalExports: Map<string, ExternalExport[]>, wildcardExports: Array<WildcardExport>}>}
   */
  async gatherExports(filePath) {
    let ast;
    try {
      ast = await this.parse(filePath);
    } catch (_) {
      // If the file couldn't be parsed, we can still recover gracefully and
      // just treat it as an empty file.
      // TODO: Should probably at least report that it couldn't be found/parsed.
      return {sourceExports: new Map(), externalExports: new Map(), wildcardExports: []};
    }

    /** @type {Map<string, SourceExport>} */
    const sourceExports = new Map();

    /** @type {Array<WildcardExport>} */
    const wildcardExports = [];

    /** @type {Map<string, ExternalExport[]>} */
    const externalExports = new Map();

    traverse(ast, {
      ExportNamedDeclaration(path) {
        // export {Foo} from 'foo';
        if (path.node.source) {
          const sourceFile = path.node.source.value;
          for (const [index, specifier] of path.node.specifiers.entries()) {
            const exportName = specifier.exported['name'];
            /** @type {NodePath} */
            // @ts-expect-error
            const specifierPath = path.get(`specifiers.${index}`);

            if (specifier.type === 'ExportNamespaceSpecifier') {
              // export * as Foo from 'foo';
              sourceExports.set(exportName, {
                type: 'namespace',
                name: exportName, // Foo
                sourceFile: sourceFile, // 'foo'
                path: specifierPath,
                id: util.makeId(filePath, exportName),
              });
            } else {
              // export {Foo as Bar} from 'foo';
              const list = externalExports.get(sourceFile) ?? [];
              list.push({
                type: 'external',
                name: exportName, // Bar
                sourceName: specifier['local'].name, // Foo
                sourceFile: sourceFile, // 'foo'
                path: specifierPath,
              });
              externalExports.set(sourceFile, list);
            }
          }
        } else if (path.node.declaration) {
          if ('id' in path.node.declaration && t.isIdentifier(path.node.declaration.id)) {
            const name = path.node.declaration.id.name;

            // export class Foo {};
            sourceExports.set(name, {
              type: 'symbol',
              name, // Foo
              sourceName: name, // Foo
              // @ts-expect-error .get() is wild
              path: path.get('declaration'),
              id: util.makeId(filePath, name),
            });
          } else {
            // export Foo = class Bar {}, foo = function bar() {};
            const identifiers = t.getBindingIdentifiers(path.node.declaration);
            for (const [index, id] of Object.keys(identifiers).entries()) {
              const name = identifiers[id].name;
              sourceExports.set(name, {
                type: 'symbol',
                name, // Foo
                sourceName: name, // Foo
                path: path.get('declaration.declarations')[index],
                id: util.makeId(filePath, name),
              });
            }
          }
        } else if (path.node.specifiers.length > 0) {
          // export {Foo as Bar};
          for (const specifier of path.node.specifiers) {
            // @ts-expect-error specifier.local is guaranteed to exist here
            const localName = specifier.local.name;
            // @ts-expect-error exported.name is guaranteed to exist here
            const exportName = specifier.exported.name;

            const bindingPath = path.scope.getBinding(localName)?.path ?? getTypeBinding(path, localName)?.path;
            // If no binding was found, it's an unresolved value, so ignore it.
            if (bindingPath == null) return;

            sourceExports.set(localName, {
              type: 'symbol',
              name: exportName, // Bar
              sourceName: localName, // Foo
              path: bindingPath,
              id: util.makeId(filePath, exportName),
            });
          }
        }
      },

      // export * from 'foo';
      // Note that `export * as Foo from 'foo'` is considered an ExportNamedDeclaration
      // in babel, but other parsers consider that an ExportAllDeclaration.
      ExportAllDeclaration(path) {
        wildcardExports.push({type: 'wildcard', sourceFile: path.node.source.value});
      },

      // TODO: Handle default exports
      ExportDefaultDeclaration(_path) {},
    });

    return {sourceExports, externalExports, wildcardExports};
  }

  /**
   * Starting at `filePath` gather all of the exports named by the file. For
   * any exports sourced from another file (e.g., `export {Foo} from 'foo';`
   * or `export * from 'foo';`), recurse through those depdencies to find the
   * originating declaration of all named symbols.
   *
   * At each file in the recursion, add the complete list of found symbols to
   * the cache so that future requests can skip this step, so long as the file
   * doesn't get invalidated between now and then.
   *
   * The returned map ties symbol names from the file to their originating
   * export, no matter where that export may have come from.
   *
   * @param {string} filePath
   * @returns {Promise<Map<string, SourceExport>>}
   */
  async buildExportGraph(filePath) {
    const cached = this.host.cache.getExportsFromFile(filePath);
    if (cached != null) return cached;

    /** @type {Map<string, SourceExport>} */
    const sourceExports = new Map();

    // TODO: Mark dependencies and let the host know so it can attach watchers
    // and stuff to trigger reloads appropriately.
    const {sourceExports: gatheredSourceExports, externalExports, wildcardExports} = await this.gatherExports(filePath);
    for (const [name, source] of gatheredSourceExports) {
      sourceExports.set(name, source);
    }

    // Append the named exports from external exports to this export.
    for (const [sourceFile, exports] of externalExports) {
      const sourcePath = await this.host.resolve(sourceFile, filePath);
      // Recurse to discover all of the exports from the file, even if they
      // won't be used.
      const gathered = await this.buildExportGraph(sourcePath);
      for (const exported of exports) {
        const source = gathered.get(exported.sourceName);
        // If the export wasn't found in the source file, then just skip it.
        // This should never happen, since it would be an error otherwise, but
        // rather than throw, we can continue gracefully.
        if (source == null) continue;

        // Ensure that the export gets renamed publicly.
        sourceExports.set(exported.name, {...source, name: exported.name});
      }
    }

    // Append _all_ of the symbols from any wildcard exports
    for (const wildcard of wildcardExports) {
      const sourcePath = await this.host.resolve(wildcard.sourceFile, filePath);
      const dependencyExports = await this.buildExportGraph(sourcePath);
      for (const [name, source] of dependencyExports) {
        sourceExports.set(name, source);
      }
    }

    this.host.cache.setExportsFromFile(filePath, sourceExports);

    return sourceExports;
  }
};
