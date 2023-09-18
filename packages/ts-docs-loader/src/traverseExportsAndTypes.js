// @ts-check

const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const util = require('./util');

/**
 * @template [T=t.Node]
 * @typedef {import('@babel/traverse').NodePath<T>} NodePath<T>
 */

/**
 * @typedef {import('@babel/traverse').Scope} Scope
 *
 * @typedef {import('./types').BabelAST} BabelAST
 * @typedef {import('./types').TypeScope} TypeScope
 * @typedef {import('./types').Export} Export
 * @typedef {import('./types').SourceExport} SourceExport
 * @typedef {import('./types').SymbolExport} SymbolExport
 * @typedef {import('./types').NamespaceExport} NamespaceExport
 * @typedef {import('./types').ExternalExport} ExternalExport
 * @typedef {import('./types').WildcardExport} WildcardExport
 *
 * @typedef {{kind: string, path: NodePath}} TypeBinding
 *
 * @typedef GatherResult
 * @prop {Map<string, SourceExport>} sourceExports Map of exports originating from this file.
 * @prop {Map<string, ExternalExport[]>} externalExports Map of file names to exports sourced from those files.
 * @prop {Array<WildcardExport>} wildcardExports List of all wildcard exports exposed by this file.
 * @prop {Map<Scope, Map<string, TypeBinding>>} typeScopes Map of Scopes (from Babel) to the type bindings contained in it.
 */

/**
 * @param {NodePath} path
 * @returns {boolean}
 */
function isTypeDeclaration(path) {
  return (
    path.isTypeAlias() ||
    path.isClassDeclaration() ||
    path.isInterfaceDeclaration() ||
    path.isTSTypeAliasDeclaration() ||
    path.isTSInterfaceDeclaration() ||
    path.isTSEnumDeclaration() ||
    path.isTSModuleDeclaration()
  );
}

/**
 *
 * @param {Scope} scope
 * @param {string} name
 * @param {Map<Scope, TypeScope>} typeScopes
 * @returns {TypeBinding | undefined}
 */
function getTypeBinding(scope, name, typeScopes) {
  let currentScope = scope;
  while (currentScope != null) {
    const found = typeScopes.get(currentScope)?.get(name);
    if (found) return found;

    currentScope = currentScope.parent;
  }

  return undefined;
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
 * Additionally, this method gathers type bindings pre-emptively to be able
 * to map source exports of types to the declarations they originate at.
 *
 * @param {string} filePath
 * @param {BabelAST} ast
 *
 * @returns {GatherResult}
 */
function traverseExportsAndTypes(filePath, ast) {
  /** @type {Map<string, SourceExport>} */
  const sourceExports = new Map();
  /** @type {Map<string, ExternalExport[]>} */
  const externalExports = new Map();
  /** @type {Array<WildcardExport>} */
  const wildcardExports = [];

  const typeScopes = traverseTypeScopes(ast);

  /**
   * @param {NodePath<t.ExportNamedDeclaration>} path
   */
  function handleExportFromSource(path) {
    if (path.node.source == null) return;

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
  }

  /**
   * @param {NodePath<t.ExportNamedDeclaration>} path
   */
  function handleExportDeclaration(path) {
    if (path.node.declaration == null) return;

    // export class Foo {};
    if ('id' in path.node.declaration && t.isIdentifier(path.node.declaration.id)) {
      const name = path.node.declaration.id.name;
      sourceExports.set(name, {
        type: 'symbol',
        name, // Foo
        sourceName: name, // Foo
        // @ts-expect-error .get() is wild
        path: path.get('declaration'),
        id: util.makeId(filePath, name),
      });
      // export Foo = class Bar {}, foo = function bar() {};
    } else {
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
  }

  /**
   * @param {NodePath<t.ExportNamedDeclaration>} path
   */
  function handleLocalExport(path) {
    for (const specifier of path.node.specifiers) {
      // @ts-expect-error specifier.local is guaranteed to exist here
      const localName = specifier.local.name;
      // @ts-expect-error exported.name is guaranteed to exist here
      const exportName = specifier.exported.name;

      const bindingPath = path.scope.getBinding(localName)?.path ?? typeScopes.get(path.scope)?.get(localName)?.path;
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

  ///
  // Exports
  ///
  traverse(ast, {
    ExportNamedDeclaration(path) {
      // export {Foo} from 'foo';
      if (path.node.source != null) {
        handleExportFromSource(path);
      } else if (path.node.declaration) {
        handleExportDeclaration(path);
        // export {Foo as Bar};
      } else if (path.node.specifiers.length > 0) {
        handleLocalExport(path);
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

  return {sourceExports, externalExports, wildcardExports, typeScopes};
}

/**
 * Traverse the given AST, capturing all of the type bindings and the scope
 * that they are created in, returning a map of Scopes to the set of bindings
 * created within them.
 *
 * @param {BabelAST} ast
 * @returns {Map<Scope, TypeScope>}
 */
function traverseTypeScopes(ast) {
  /** @type {Map<Scope, TypeScope>} */
  const typeScopes = new Map();

  ///
  // Type Bindings
  ///
  traverse(
    ast,
    {
      Declaration(path, state) {
        /** @type {Map<string, TypeBinding>} */
        const typeScope = state.typeScopes.get(path.scope) ?? new Map();
        if (isTypeDeclaration(path) && 'id' in path.node && path.node.id != null) {
          typeScope.set(path.node.id['name'], {kind: 'declaration', path});
        }

        state.typeScopes.set(path.scope, typeScope);
      },
    },
    undefined,
    {typeScopes},
  );

  return typeScopes;
}

module.exports = {
  traverseExportsAndTypes,
  traverseTypeScopes,
  getTypeBinding,
};
