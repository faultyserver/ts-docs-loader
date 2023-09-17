// @ts-check

// Adapted from https://github.com/babel-utils/babel-type-scopes/blob/dea5a749b522649ded4f1a03aecf3f3f03fa31f1/index.js

const {NodePath} = require('@babel/traverse');

/**
 * @typedef {{kind: string, path: NodePath}} TypeBinding
 */

/**
 * @param {string} kind
 * @param {NodePath} path
 * @param {Record<string, TypeBinding>} bindings
 */
function getId(kind, path, bindings) {
  if ('id' in path.node && path.node.id != null) {
    /** @type {NodePath} */
    const id = path.get('id');
    bindings[id.node.name] = {kind, path: id};
  }
}

const visitor = {
  Scope(path) {
    path.skip();
  },

  Declaration(path, state) {
    if (isTypeDeclaration(path)) {
      getId('declaration', path, state.bindings);
    }

    if (!path.isImportDeclaration() && !path.isExportDeclaration()) {
      path.skip();
    }
  },

  TypeParameter(path, state) {
    state.bindings[path.node.name] = {kind: 'param', path};
  },

  'ImportSpecifier|ImportDefaultSpecifier'(path, state) {
    const importKind = path.node.importKind || path.parent.importKind;
    if (importKind !== 'type' && importKind !== 'typeof') return;
    const local = path.get('local');
    state.bindings[local.node.name] = {kind: 'import', path: local};
  },
};

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
 * @param {NodePath} path
 * @returns {boolean}
 */
function isTypeExpression(path) {
  return path.isClassExpression();
}

/**
 * @param {NodePath} path
 * @returns {boolean}
 */
function isTypeScope(path) {
  return (
    path.isScope() ||
    path.isFunctionTypeAnnotation() ||
    path.isTypeAlias() ||
    path.isInterfaceDeclaration() ||
    isTypeDeclaration(path)
  );
}

/**
 * @param {NodePath} path
 * @returns {Record<string, TypeBinding>}
 */
function getOwnTypeBindings(path /*: Path */) {
  if (!isTypeScope(path)) {
    throw new Error('Must pass valid type scope path using getClosestTypeScope()');
  }

  /** @type {Record<string, TypeBinding>} */
  const bindings = {};

  if (isTypeExpression(path) && path.node.id) {
    getId('expression', path, bindings);
  } else {
    path.traverse(visitor, {bindings});
  }

  return bindings;
}

function getTypeBinding(path /*: Path */, name /*: string */) /*: Binding */ {
  let searching = path;

  do {
    searching = getClosestTypeScope(searching);
    const bindings = getOwnTypeBindings(searching);
    if (bindings[name]) return bindings[name];
  } while ((searching = searching.parentPath));

  return null;
}

function getClosestTypeScope(path /*: Path */) /*: Path */ {
  return path.find((p) => isTypeScope(p));
}

module.exports = {
  isTypeScope,
  getClosestTypeScope,
  getOwnTypeBindings,
  getTypeBinding,
};
