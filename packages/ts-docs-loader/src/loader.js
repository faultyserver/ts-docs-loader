// @ts-check
const babel = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const Packager = require('./packager');
const Transformer = require('./transformer');

/**
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('./transformer').Dependency} Dependency
 * @typedef {{exports: object, links: object}} LoadResult
 *
 * @typedef TransformResult
 * @property {Map<string, any>} symbols
 * @property {Record<string, any>} exportedNodes
 * @property {Dependency[]} dependencies
 *
 * @typedef Bundler
 * @property {() => string} getFilePath
 * @property {() => string} getContext
 * @property {(filePath: string) => Promise<string>} getSource
 * @property {(filePath: string, symbols?: string[]) => Promise<LoadResult>} importModule
 * @property {(path: string) => Promise<string>} resolve
 * @property {(filePath: string, symbols?: string[]) => boolean} isCurrentlyProcessing
 */

module.exports = class Loader {
  /** @param {Bundler} bundler An adapter to the host bundler to load code, resolve module dependencies, and recurse with. */
  constructor(bundler) {
    /** @type {Bundler} */
    this.bundler = bundler;
  }

  /**
   * This is the main loop of the loader. It takes in the raw source code of a
   * module, parses it, transforms the content into a documentation node tree,
   * then recurses through all of the found dependencies to get their content,
   * and finally packages all of the data from the module and its dependencies
   * into a single result.
   *
   * If `symbols` is given, only those symbols will be processed and returned,
   * allowing for granular traversal of dependencies and helping to avoid many
   * circular dependency problems. Otherwise, all symbols defined in the asset
   * will be processed.
   *
   * @type {(filePath: string, symbols?: string[]) => Promise<LoadResult>}
   */
  async load(filePath, symbols) {
    const source = await this.bundler.getSource(filePath);
    const ast = this.parse(source, filePath);
    const result = this.transform(ast, filePath, symbols);

    const resolvedDependencies = await this.recurseDependencies(result.dependencies);

    const thisAsset = {id: filePath, exports: result.exportedNodes, symbols: result.symbols, links: {}};
    return new Packager(thisAsset, resolvedDependencies).run();
  }

  /**
   * Iterate the dependencies of this module and recursively invoke the bundler
   * on them.
   *
   * @param {Dependency[]} dependencies
   * @returns {Promise<Record<string, Asset>>}
   */
  async recurseDependencies(dependencies) {
    /** @type {Record<string, Asset>} */
    const resolvedDependencies = {};
    for (const dependency of dependencies) {
      const resolvedPath = await this.bundler.resolve(dependency.path);

      // If somehow the dependency exists but there aren't any symbols, it can
      // be skipped entirely.
      const dependencySymbols = Array.from(dependency.symbols.values());
      if (dependencySymbols.length === 0) continue;

      // If there's a wildcard in the list of requested symbols, then we need
      // to resolve all of them, so the requestedSymbols can/should be blank.
      const requestedSymbols = dependencySymbols.includes('*') ? undefined : dependencySymbols;

      // Really naive circular dependencies atm. Just returning a blank result
      // if the requested file is already in progress. Using `requestedSymbols`
      // here helps reduce instances of this, but still would be good to create
      // a stubbed instance or something so that links are at least resolved.
      if (this.bundler.isCurrentlyProcessing(resolvedPath, requestedSymbols)) {
        resolvedDependencies[dependency.path] = {
          id: resolvedPath,
          exports: {},
          links: {},
          symbols: new Map(),
        };
        continue;
      }

      const data = await this.bundler.importModule(resolvedPath, requestedSymbols);
      resolvedDependencies[dependency.path] = {
        id: resolvedPath,
        exports: data.exports,
        links: data.links,
        symbols: dependency.symbols,
      };
    }

    return resolvedDependencies;
  }

  /**
   * Return a parsed AST of the source code. Right now this is dependent on
   * it being a babel-compatible AST that handles TypeScript.
   *
   * @param {string} source
   * @param {string} filePath
   * @returns {import('@babel/parser').ParseResult<import('@babel/types').File>}
   */
  parse(source, filePath) {
    const isAmbient = filePath.endsWith('.d.ts');

    return babel.parse(source, {
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
  }

  /**
   *
   * @param {import('@babel/parser').ParseResult<import('@babel/types').File>} ast
   * @param {string} filePath
   * @param {string[]=} requestedSymbols
   * @returns {TransformResult}
   */
  transform(ast, filePath, requestedSymbols) {
    const transformer = new Transformer(filePath);
    /**
     * Record of entities that are exported from this file.
     * Entities with dependencies coming from other files will have them marked
     * as `link` nodes to be resolved in a future step.
     *
     * @type {Record<string, Node>}
     */
    const exportedNodes = {};

    /**
     * Map of values exported from this module, where the key is the name that
     * is exported publicly, and the value is the name of the entity within the
     * module.
     *
     * EX: export {foo as Bar, abc}; -> {Bar => foo, abc => abc}
     *
     *
     * @type {Map<string, string>}
     */
    const symbols = new Map();

    /** @type {(symbol: string) => boolean} */
    function isSymbolRequested(symbol) {
      return requestedSymbols == null || requestedSymbols.includes(symbol);
    }

    traverse(ast, {
      // Babel doesn't consider type statements as identifiers, so they need to be
      // tracked manually, which is kept by the transformer in `globalTypes`.
      Statement(path) {
        if (
          path.isTSTypeAliasDeclaration() ||
          (path.isTSDeclareFunction() && path.get('id').isIdentifier()) ||
          path.isTSInterfaceDeclaration() ||
          path.isClassDeclaration({declare: true}) ||
          path.isTSEnumDeclaration({declare: true}) ||
          (path.isTSModuleDeclaration({declare: true}) && path.get('id').isIdentifier())
        ) {
          // @ts-expect-error the above conditions assert that `path.node.id.name` should exist
          transformer.addGlobalType(path.node.id.name, path);
        }
      },
      ExportNamedDeclaration(path) {
        // export {Foo} from 'foo';
        if (path.node.source) {
          // `dependencySymbols` is flipped from `symbols`, tracking the
          // export name (`as Bar`) as the key and the local name (`Foo as`)
          // as the value, so that the mapping can be looked up when packaging.
          const dependencySymbols = new Map();
          for (const specifier of path.node.specifiers) {
            const exportName = specifier.exported['name'];
            if (!isSymbolRequested(exportName)) continue;

            // This module only cares about the actual exported name
            symbols.set(exportName, exportName);

            // export * as Foo from 'foo';
            if (specifier.type === 'ExportNamespaceSpecifier') {
              dependencySymbols.set(exportName, '*');
              // export {Foo as Bar} from 'foo';
            } else {
              const sourceName = specifier['local'].name;
              dependencySymbols.set(exportName, sourceName);
            }
          }

          if (dependencySymbols.size == 0) return;

          transformer.addDependency(path.node.source.value, dependencySymbols);
          // export const Foo = {};
        } else if (path.node.declaration) {
          if ('id' in path.node.declaration && t.isIdentifier(path.node.declaration.id)) {
            const name = path.node.declaration.id.name;
            if (!isSymbolRequested(name)) return;

            symbols.set(name, name);
            const prev = exportedNodes[name];
            // @ts-expect-error .get() is wild
            const val = transformer.processExport(path.get('declaration'));
            if (val != null) {
              exportedNodes[name] = val;
              if (exportedNodes[name].description == null && prev?.description) {
                exportedNodes[name].description = prev.description;
              }
            }
          } else {
            const identifiers = t.getBindingIdentifiers(path.node.declaration);
            for (const [index, id] of Object.keys(identifiers).entries()) {
              const name = identifiers[id].name;
              if (!isSymbolRequested(name)) continue;

              exportedNodes[identifiers[id].name] = transformer.processExport(
                path.get('declaration.declarations')[index],
              );
              symbols.set(identifiers[id].name, identifiers[id].name);
            }
          }
          // export {Bar, Foo as F};
        } else if (path.node.specifiers.length > 0) {
          for (const specifier of path.node.specifiers) {
            // @ts-expect-error specifier.local is guaranteed to exist here
            const localName = specifier.local.name;
            if (!isSymbolRequested(localName)) continue;

            const bindingPath = path.scope.getBinding(localName)?.path ?? transformer.globalTypes.get(localName);
            if (bindingPath) {
              const value = transformer.processExport(bindingPath);
              // @ts-expect-error exported.name is guaranteed to exist here
              const exportName = specifier.exported.name;
              if (value.name != null) {
                value.name = exportName;
              }
              exportedNodes[exportName] = value;
              symbols.set(specifier['local'].name, exportName);
            }
          }
        }
      },

      // export * from 'foo';
      // Note that `export * as Foo from 'foo'` is considered an ExportNamedDeclaration
      // in babel, but other parsers consider that an ExportAllDeclaration.
      ExportAllDeclaration(path) {
        transformer.addDependency(path.node.source.value, new Map([['*', '*']]));
      },

      ExportDefaultDeclaration(_path) {},
    });

    return {symbols, exportedNodes, dependencies: transformer.dependencies};
  }
};
