const babel = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

const packager = require('./packager');
const Transformer = require('./transformer');

/**
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
 * @property {(filePath: string) => Promise<LoadResult>} importModule
 * @property {(path: string) => Promise<string>} resolve
 * @property {(filePath: string) => boolean} isCurrentlyProcessing
 */

module.exports = class Loader {
  /** @param {Bundler} bundler */
  constructor(bundler) {
    /** @type {Bundler}*/
    this.bundler = bundler;
  }

  /**
   * @type {(filePath: string) => Promise<LoadResult>}
   */
  async load(filePath) {
    const source = await this.bundler.getSource(filePath);
    const ast = this.parse(source);
    const result = this.transform(ast, this.bundler.getFilePath());

    const resolvedDependencies = await this.recurseDependencies(result.dependencies);

    const thisAsset = {id: filePath, exports: result.exportedNodes, symbols: result.symbols, links: result.links};
    return packager(thisAsset, resolvedDependencies);
  }

  /**
   * Iterate the dependencies of this module and recursively invoke the bundler
   * on them.
   *
   * @param {Dependency[]} dependencies
   * @returns {Promise<Record<string, Dependency>>}
   */
  async recurseDependencies(dependencies) {
    const resolvedDependencies = {};
    for (const dependency of dependencies) {
      const resolvedPath = await this.bundler.resolve(dependency.path);

      // Really naive circular dependencies atm.
      if (this.bundler.isCurrentlyProcessing(resolvedPath)) {
        resolvedDependencies[dependency.path] = {
          id: resolvedPath,
          exports: {},
          links: {},
          symbols: new Map(),
        };
        continue;
      }

      const data = await this.bundler.importModule(resolvedPath);
      resolvedDependencies[dependency.path] = {
        id: resolvedPath,
        exports: data.default.exports,
        links: data.default.links,
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
   * @returns {import('@babel/parser').ParseResult<import('@babel/types').File>}
   */
  parse(source) {
    const isAmbient = this.bundler.getFilePath().endsWith('.d.ts');

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
   * @returns {TransformResult}
   */
  transform(ast, filePath) {
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
     * @type {Map<string, string>}
     */
    const symbols = new Map();

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
        if (path.node.source) {
          const dependencySymbols = new Map();
          for (const specifier of path.node.specifiers) {
            if (specifier.type === 'ExportNamespaceSpecifier') {
              symbols.set(specifier.exported['name'], specifier.exported['name']);
              dependencySymbols.set('*', specifier.exported['name']);
            } else {
              symbols.set(specifier.exported['name'], specifier.exported['name']);
              dependencySymbols.set(specifier['local'].name, specifier.exported['name']);
            }
          }
          transformer.addDependency(path.node.source.value, dependencySymbols);
        } else if (path.node.declaration) {
          if ('id' in path.node.declaration && t.isIdentifier(path.node.declaration.id)) {
            const name = path.node.declaration.id.name;
            symbols.set(name, name);
            const prev = exportedNodes[name];
            // @ts-expect-error .get() is wild
            const val = transformer.processExport(path.get('declaration'));
            if (val) {
              exportedNodes[name] = val;
              if (exportedNodes[name].description == null && prev?.description) {
                exportedNodes[name].description = prev.description;
              }
            }
          } else {
            const identifiers = t.getBindingIdentifiers(path.node.declaration);
            for (const [index, id] of Object.keys(identifiers).entries()) {
              exportedNodes[identifiers[id].name] = transformer.processExport(
                path.get('declaration.declarations')[index],
              );
              symbols.set(identifiers[id].name, identifiers[id].name);
            }
          }
        } else if (path.node.specifiers.length > 0) {
          for (const specifier of path.node.specifiers) {
            // @ts-expect-error specifier.local is guaranteed to exist here
            const binding = path.scope.getBinding(specifier.local.name);
            if (binding) {
              const value = transformer.processExport(binding.path);
              if (value.name != null) {
                // @ts-expect-error exported.name is guaranteed to exist here
                value.name = specifier.exported.name;
              }
              // @ts-expect-error exported.name is guaranteed to exist here
              exportedNodes[specifier.exported.name] = value;
              symbols.set(specifier.exported['name'], specifier['local'].name);
            }
          }
        }
      },

      ExportAllDeclaration(path) {
        transformer.addDependency(path.node.source.value, new Map([['*', '*']]));
      },

      ExportDefaultDeclaration(_path) {},
    });

    return {symbols, exportedNodes, dependencies: transformer.dependencies};
  }
};
