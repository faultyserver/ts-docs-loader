// @ts-check

/**
 * Adapted from parcel-transformer-docs and parcel-packager-docs from Adobe Spectrum.
 *
 * See https://github.com/adobe/react-spectrum/blob/main/packages/dev/parcel-transformer-docs/DocsTransformer.js.
 */

const {parse} = require('@babel/parser');
const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const thisLoaderPath = require.resolve('./index.js');

const bundle = require('./src/bundler');
const Transformer = require('./src/transformer');
const getTSResolver = require('./src/resolver');

/**
 * Map containing all files that are currently being processed by the loader,
 * as a naive way of dealing with circular dependencies.
 */
const IN_PROGRESS_SET = new Set();

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').Asset} Asset
 */

/**
 * @this import('webpack').LoaderContext<any>
 * @param {string} source Raw source of the asset
 */
module.exports = async function docsLoader(source) {
  IN_PROGRESS_SET.add(this.resourcePath);
  const callback = this.async();

  const isAmbient = this.resourcePath.endsWith('.d.ts');

  const ast = parse(source, {
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

  const transformer = new Transformer(this.resourcePath);

  /**
   * Record of entities that are exported from this file.
   * Entities with dependencies coming from other files will have them marked
   * as `link` nodes to be resolved in a future step.
   *
   * @type {Record<string, Node>}
   */
  const exports = {};

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
          const prev = exports[name];
          // @ts-expect-error .get() is wild
          const val = transformer.processExport(path.get('declaration'));
          if (val) {
            exports[name] = val;
            if (exports[name].description == null && prev?.description) {
              exports[name].description = prev.description;
            }
          }
        } else {
          const identifiers = t.getBindingIdentifiers(path.node.declaration);
          for (const [index, id] of Object.keys(identifiers).entries()) {
            exports[identifiers[id].name] = transformer.processExport(path.get('declaration.declarations')[index]);
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
            exports[specifier.exported.name] = value;
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

  /** @type {Asset} */
  const thisAsset = {id: this.resourcePath, exports, links: {}, symbols};

  const resolve = this.getResolve({
    extensions: ['.ts', '.tsx', '.d.ts', '.js'],
    mainFields: ['source', 'types', 'main'],
  });
  /** @type {Record<string, Asset>} */
  const resolvedDependencies = {};

  const tsResolver = getTSResolver(this.context);
  for (const dependency of transformer.dependencies) {
    const tsModule = tsResolver?.(dependency.path);
    const path = tsModule?.resolvedModule?.resolvedFileName ?? (await resolve(this.context, dependency.path));

    // Really naive circular dependencies atm.
    if (IN_PROGRESS_SET.has(path)) {
      resolvedDependencies[dependency.path] = {
        id: path,
        exports: {},
        links: {},
        symbols: new Map(),
      };
      continue;
    }

    const deps = await this.importModule(`!!${thisLoaderPath}!${path}`, {}).catch((e) => {
      console.error(e);
    });
    resolvedDependencies[dependency.path] = {
      id: path,
      exports: deps.default.exports,
      links: deps.default.links,
      symbols: dependency.symbols,
    };
  }

  const bundledExports = bundle(thisAsset, resolvedDependencies);
  const result = `export default ${JSON.stringify(bundledExports)};`;
  callback(null, result);
  IN_PROGRESS_SET.delete(this.resourcePath);
};
