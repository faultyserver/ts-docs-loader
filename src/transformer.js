/* eslint-disable no-console */
// @ts-check

const t = require('@babel/types');
const {NodePath} = require('@babel/traverse');
const doctrine = require('doctrine');

// @ts-expect-error intentionally unused, just importing to simplify types later on
new NodePath();

/**
 * @typedef {import('webpack').LoaderContext<any>} LoaderContext
 *
 * @typedef {import('./nodeTypes').Node} Node
 * @typedef {Partial<Node>} PartialNode
 * @typedef {import('./nodeTypes').NodeDocs} NodeDocs
 */

module.exports = class Transformer {
  /**
   * @param {string} filePath - Absolute file path for the source
   */
  constructor(filePath) {
    /** @type {string} */
    this.filePath = filePath;
    /**
     * A cache to avoid re-processing paths from the tree
     */
    this.nodeCache = new Map();
    /**
     * Flattened list of this file's dependencies on other files. All links
     * within this file should have a matching dependency included here.
     * @type {({path: string, symbols: Map<string, string>})[]}
     */
    this.dependencies = [];

    /** @type {Map<string, NodePath>} */
    this.globalTypes = new Map();
  }

  /**
   * Add the given filePath to the list of dependencies for this file.
   *
   * @param {string} filePath
   * @param {Map<string, string>} symbols - map of symbol names this asset uses from the dependency.
   */
  addDependency(filePath, symbols) {
    const existing = this.dependencies.find((dep) => dep.path === filePath);
    // If the dependency already exists, just amend the symbols for it.
    if (existing != null) {
      for (const [local, source] of symbols.entries()) {
        existing.symbols.set(local, source);
      }
    }
    this.dependencies.push({path: filePath, symbols});
  }

  /**
   * Register a type defined within the file. Babel doesn't consider these
   * bindings, so they can't be referenced when looking up identifiers.
   * Example:
   *  interface Bar {}
   *  interface Foo extends Bar {}
   * The transformer wouldn't know to resolve Bar to the interface declaration,
   * because it's not considered "bound". This global type registry acts as a
   * secondary lookup source to find and resolve these types.
   *
   * @param {string} name
   * @param {NodePath} path
   */
  addGlobalType(name, path) {
    this.globalTypes.set(name, path);
  }

  /**
   * @param {NodePath} p
   * @returns {import("./nodeTypes").ParameterNode}
   */
  processParameter(p) {
    if (p.isAssignmentPattern()) {
      p = p.get('left');
    }

    return {
      type: 'parameter',
      name: p.isRestElement() ? p.node.argument['name'] : p.node['name'],
      value:
        'typeAnnotation' in p.node && p.node.typeAnnotation != null
          ? // @ts-ignore
            this.processExport(p.get('typeAnnotation.typeAnnotation'))
          : {type: 'any'},
      optional: 'optional' in p.node ? p.node.optional != null : false,
      rest: p.isRestElement(),
    };
  }

  /**
   * Returns true if the call corresponds to something imported from
   * react, either through `React.` or by itself.
   *
   * @param {NodePath} path
   * @param {string} name
   * @param {string} module
   */
  isReactCall(path, name, module = 'react') {
    if (!path.isCallExpression()) {
      return false;
    }

    let callee = path.node.callee;
    let calleePath = path.get('callee');
    if (t.isTSAsExpression(callee)) {
      callee = callee.expression;
      // @ts-expect-error The type is ensured by the `t.is` above, not sure how, though
      calleePath = calleePath.get('expression');
    }

    if (!t.isMemberExpression(callee)) {
      return calleePath.referencesImport(module, name);
    }

    if (/** @type {NodePath} */ (calleePath.get('object')).referencesImport(module, 'default')) {
      return t.isIdentifier(callee.property, {name});
    }
  }

  /**
   * Matches any call to React's forwardRef, qualified or not.
   *
   * @param {NodePath} path
   * @returns {boolean}
   */
  isReactForwardRef(path) {
    return (
      this.isReactCall(path, 'forwardRef') ||
      (path.isCallExpression() && path.get('callee').isIdentifier({name: 'createHideableComponent'}))
    );
  }

  /**
   * @param {t.TSType | undefined} returnType
   * @returns {boolean}
   */
  isJSXElementType(returnType) {
    return (
      returnType != null &&
      t.isTSTypeReference(returnType) &&
      t.isTSQualifiedName(returnType.typeName) &&
      t.isIdentifier(returnType.typeName.left, {name: 'JSX'}) &&
      t.isIdentifier(returnType.typeName.right, {name: 'Element'})
    );
  }

  /**
   * Only supports function components for now. Returns true if the component
   * returns some form of JSX element.
   *
   * @param {NodePath} path
   * @returns {boolean}
   */
  isReactComponent(path) {
    if (path.isFunction()) {
      /** @type {t.TSType | undefined} */
      // @ts-expect-error typeAnnotation doesn't exist on Noop, but we don't care.
      const returnType = path.node.returnType?.typeAnnotation;
      if (this.isJSXElementType(returnType)) {
        return true;
      }

      if (returnType && t.isTSUnionType(returnType) && returnType.types.some(this.isJSXElementType)) {
        return true;
      }

      let returnsJSX = false;
      path.traverse({
        ReturnStatement: (returnPath) => {
          const ret = returnPath.node.argument;
          // This traversal will include nested function returns, but those
          // don't necessarily mean the parent is a component (e.g., a hook
          // that returns a ReactNode is not a component).
          if (returnPath.getFunctionParent() !== path) return;

          if (
            t.isJSXElement(ret) ||
            t.isJSXFragment(ret) ||
            // @ts-ignore
            this.isReactCall(path.get('argument'), 'cloneElement') ||
            // @ts-ignore
            this.isReactCall(returnPath.get('argument'), 'createPortal', 'react-dom')
          ) {
            returnsJSX = true;
          }
        },
      });

      return returnsJSX;
    }

    // TODO: classes

    return false;
  }

  /**
   * @param {t.Comment} comment
   * @returns {boolean}
   */
  isJSDocComment(comment) {
    const asterisks = comment.value.match(/^(\*+)/);

    // @ts-ignore
    return comment.type === 'CommentBlock' && asterisks && asterisks[1].length === 1;
  }

  /**
   * @param {NodePath} path
   * @returns {string | null}
   */
  getDocComments(path) {
    if (path.node.leadingComments) {
      return path.node.leadingComments
        .filter(this.isJSDocComment)
        .map((c) => c.value)
        .join('\n');
    }

    // @ts-expect-error path.parentPath is only null for Program, which this won't be.
    if (path.parentPath.isExportDeclaration() && path.parent.leadingComments) {
      return path.parent.leadingComments
        .filter(this.isJSDocComment)
        .map((c) => c.value)
        .join('\n');
    }

    return null;
  }

  /**
   *
   * @param {NodePath} path
   * @returns {NodeDocs}
   */
  getJSDocs(path) {
    const comments = this.getDocComments(path);
    if (comments) {
      const parsed = doctrine.parse(comments, {
        // have doctrine itself remove the comment asterisks from content
        unwrap: true,
        // enable parsing of optional parameters in brackets, JSDoc3 style
        sloppy: true,
        // `recoverable: true` is the only way to get error information out
        recoverable: true,
      });

      /** @type {NodeDocs} */
      const result = {
        description: parsed.description,
      };

      for (const tag of parsed.tags) {
        if (tag.title === 'default') {
          result.default = tag.description;
        } else if (tag.title === 'access') {
          result.access = tag.description;
        } else if (tag.title === 'private' || tag.title === 'deprecated') {
          result.access = 'private';
        } else if (tag.title === 'protected') {
          result.access = 'protected';
        } else if (tag.title === 'public') {
          result.access = 'public';
        } else if (tag.title === 'return' || tag.title === 'returns') {
          result.return = tag.description;
        } else if (tag.title === 'param') {
          if (result.params == null) {
            result.params = {};
          }

          // @ts-expect-error Name should be explicitly ensured.
          result.params[tag.name] = tag.description;
        } else if (tag.title === 'selector') {
          result.selector = tag.description;
        }
      }

      return result;
    }

    return {};
  }

  /**
   *
   * @param {import("./nodeTypes").FunctionNode} value
   * @param {NodeDocs} docs
   */
  addFunctionDocs(value, docs) {
    const params = docs.params || {};
    for (const param of value.parameters) {
      param.description = params[param.name] || param.description || null;
    }

    if (value.return) {
      value.return.description = docs.return || value.return.description || null;
    }
  }

  /**
   *
   * @param {Node} value
   * @param {NodeDocs} docs
   * @returns
   */
  addDocs(value, docs) {
    if (!value) {
      return value;
    }

    if (docs.description) {
      value.description = docs.description;
    }

    if (docs.access) {
      value.access = docs.access;
    }

    if (docs.selector) {
      value.selector = docs.selector;
    }

    if (value.type === 'property' || value.type === 'method') {
      value.default = docs.default || value.default || null;
      if (value.value && value.value.type === 'function') {
        this.addFunctionDocs(value.value, docs);
      }
    }

    if (value.type === 'function') {
      this.addFunctionDocs(value, docs);
    }

    return value;
  }

  /**
   *
   * @param {NodePath} path
   * @param {PartialNode} node
   * @returns
   */
  processExport(path, node = {}) {
    if (this.nodeCache.has(path)) {
      return this.nodeCache.get(path);
    } else {
      this.nodeCache.set(path, node);
      return this.processPath(path, node);
    }
  }

  /**
   *
   * @param {NodePath} path
   * @param {PartialNode} node
   * @returns
   */
  processPath(path, node) {
    // (Type), often used for array literal notation.
    if (path.isTSParenthesizedType()) return this.processExport(path.get('typeAnnotation'), node);
    // foo as string
    //
    // not sure why I can't pass typeAnnotation instead
    if (path.isTSAsExpression()) return this.processExport(path.get('expression'), node);

    // React.forwardRef((props, ref) => {})
    if (this.isReactForwardRef(path)) {
      // @ts-ignore
      return this.processExport(path.get('arguments.0'), node);
    }

    if (path.isVariableDeclarator()) return this.processVariableDeclarator(path, node);
    if (path.isObjectExpression()) return this.processObjectExpression(path, node);
    if (path.isObjectProperty()) return this.processObjectProperty(path, node);
    if (path.isClassDeclaration()) return this.processClassDeclaration(path, node);
    if (path.isClassProperty()) return this.processClassProperty(path, node);
    if (path.isClassMethod() || path.isTSDeclareMethod() || path.isObjectMethod())
      return this.processMethod(path, node);
    if (path.isFunction() || path.isTSDeclareFunction()) return this.processFunction(path, node);
    if (path.isTSTypeReference()) return this.processTSTypeReference(path, node);
    if (path.isTSQualifiedName()) return this.processTSQualifiedName(path, node);
    if (
      path.isImportDefaultSpecifier() ||
      path.isImportNamespaceSpecifier() ||
      (path.isImportSpecifier() && 'source' in path.parent && path.parent.source != null)
    )
      return this.processImportSpecifier(path, node);
    if (path.isTSTypeAliasDeclaration()) return this.processTSTypeAliasDeclaration(path, node);
    if (path.isTSInterfaceDeclaration()) return this.processTSInterfaceDeclaration(path, node);
    if (path.isTSEnumDeclaration()) return this.processTSEnumDeclaration(path, node);
    if (path.isTSEnumMember()) return this.processTSEnumMember(path, node);
    if (path.isTSTypeLiteral()) return this.processTSTypeLiteral(path, node);
    if (path.isTSTypeOperator()) return this.processTSTypeOperator(path, node);
    if (path.isTSTypeQuery()) return this.processTSTypeQuery(path, node);
    if (path.isTSThisType()) return this.processTSThisType(path, node);
    if (path.isTSPropertySignature()) return this.processTSPropertySignature(path, node);
    if (path.isTSMethodSignature()) return this.processTSMethodSignature(path, node);
    if (path.isTSIndexSignature()) return this.processTSIndexSignature(path, node);
    if (path.isTSExpressionWithTypeArguments()) return this.processTSExpressionWithTypeArguments(path, node);

    if (path.isIdentifier()) return this.processIdentifier(path, node);
    // literals
    if (path.isBooleanLiteral()) return Object.assign(node, {type: 'boolean', value: String(path.node.value)});
    if (path.isStringLiteral()) return Object.assign(node, {type: 'string', value: path.node.value});
    if (path.isNumericLiteral()) return Object.assign(node, {type: 'number', value: String(path.node.value)});
    // keywords
    if (path.isTSSymbolKeyword()) return Object.assign(node, {type: 'symbol'});
    if (path.isTSBooleanKeyword()) return Object.assign(node, {type: 'boolean'});
    if (path.isTSStringKeyword()) return Object.assign(node, {type: 'string'});
    if (path.isTSNumberKeyword()) return Object.assign(node, {type: 'number'});
    if (path.isTSAnyKeyword()) return Object.assign(node, {type: 'any'});
    if (path.isTSNullKeyword()) return Object.assign(node, {type: 'null'});
    if (path.isTSUndefinedKeyword()) return Object.assign(node, {type: 'undefined'});
    if (path.isTSVoidKeyword()) return Object.assign(node, {type: 'void'});
    if (path.isTSObjectKeyword()) return Object.assign(node, {type: 'object'});
    if (path.isTSUnknownKeyword()) return Object.assign(node, {type: 'unknown'});
    if (path.isTSNeverKeyword()) return Object.assign(node, {type: 'never'});

    if (path.isTSArrayType()) return this.processTSArrayType(path, node);
    if (path.isTSUnionType()) return this.processTSUnionType(path, node);
    if (path.isTSLiteralType()) return this.processTSLiteralType(path, node);
    if (path.isTSFunctionType() || path.isTSConstructorType()) return this.processTSFunctionType(path, node);
    if (path.isTSIntersectionType()) return this.processTSIntersectionType(path, node);
    if (path.isTSTypeParameter()) return this.processTSTypeParameter(path, node);
    if (path.isTSTupleType()) return this.processTSTupleType(path, node);
    if (path.isTSTypeOperator() && path.node.operator === 'keyof') return this.processKeyofOperator(path, node);
    if (path.isTSConditionalType()) return this.processTSConditionalType(path, node);
    if (path.isTSModuleDeclaration()) return this.processTSModuleDeclaration(path, node);
    if (path.isTSIndexedAccessType()) return this.processTSIndexedAccessType(path, node);

    console.log('[Docs Transformer] UNKNOWN TYPE', path.node.type);
    return node;
  }

  /**
   * Each declaration within a VariableDeclaration statement.
   *
   * EX:
   * - const foo = 2, bar = 3;
   * - var foo = 2;
   * - let foo = 2;
   *
   * @param {NodePath<t.VariableDeclarator>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processVariableDeclarator(path, node) {
    // ? If there's no initializer, it's not worth documenting.
    if (path.node.init == null) {
      return node;
    }

    const docs = this.getJSDocs(path.parentPath);

    // @ts-ignore
    this.processExport(path.get('init'), node);

    // @ts-ignore
    this.addDocs(node, docs);
    if (node.type === 'interface') {
      node.id = `${this.filePath}:${path.node.id['name']}`;

      node.name = path.node.id['name'];
    }

    return node;
  }

  /**
   * EX: class Foo {}
   *
   * @param {NodePath<t.ClassDeclaration>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processClassDeclaration(path, node) {
    /** @type {Record<string, Node>} */
    const properties = {};

    /** @type {NodePath<t.ClassBody['body'][number]>[]} */
    // @ts-ignore the type is definitely what's above
    const bodyNodes = path.get('body.body');

    for (const propertyPath of bodyNodes) {
      // Only supporting these kinds of nodes.
      if (!['ClassProperty', 'ClassMethod', 'TSDeclareMethod'].includes(propertyPath.node.type)) continue;

      const property = this.processExport(propertyPath);
      if (property) {
        properties[property.name] = property;
      } else {
        console.log('UNKNOWN PROPERTY', propertyPath.node);
      }
    }

    // @ts-ignore
    const exts = path.node.superClass ? [this.processExport(path.get('superClass'))] : [];
    const docs = this.getJSDocs(path);

    /**
     * This won't actually be null, but the current version of typings doesn't assert that.
     * @type {string}
     */
    const name = path.node.id?.name ?? '';

    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'interface',
          id: `${this.filePath}:${name}`,
          name: name,
          extends: exts,
          // @ts-ignore enforcing this is property | method with the type check in the loop above
          properties,
          typeParameters: path.node.typeParameters
            ? // @ts-ignore
              path.get('typeParameters.params').map((p) => this.processExport(p))
            : [],
        },
        docs
      )
    );
  }

  /**
   * EX: Inside a class:
   * - foo: string = '';
   *
   * @param {NodePath<t.ClassProperty>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processClassProperty(path, node) {
    const name = t.isStringLiteral(path.node.key) ? path.node.key.value : path.node.key['name'];
    const docs = this.getJSDocs(path);
    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'property',
          name,
          value: path.node.typeAnnotation
            ? // @ts-ignore
              this.processExport(path.get('typeAnnotation.typeAnnotation'))
            : {type: 'any'},
          optional: path.node.optional || false,
          access: path.node.accessibility,
        },
        docs
      )
    );
  }

  /**
   * Object literals used as values, not type literals.
   *
   * EX:
   * - {foo: 3}
   * - {}
   *
   * @param {NodePath<t.ObjectExpression>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processObjectExpression(path, node) {
    const properties = {};
    for (const propertyPath of path.get('properties')) {
      const property = this.processExport(propertyPath);
      if (property) {
        properties[property.name] = property;
      } else {
        console.log('UNKNOWN PROPERTY', propertyPath.node);
      }
    }

    return Object.assign(node, {
      type: 'interface',
      extends: [],
      properties,
      typeParameters: [],
    });
  }

  /**
   * EX:
   * - foo: 3
   *
   * @param {NodePath<t.ObjectProperty>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processObjectProperty(path, node) {
    const name = t.isStringLiteral(path.node.key) ? path.node.key.value : path.node.key['name'];
    const docs = this.getJSDocs(path);
    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'property',
          name,
          value: this.processExport(path.get('value')),
          optional: false,
        },
        docs
      )
    );
  }

  /**
   * EX:
   * - Inside a class:
   *    foo() {}
   *    foo();
   * - Inside an object literal:
   *    {foo() {}}
   *
   * @param {NodePath<t.ClassMethod | t.TSDeclareMethod | t.ObjectMethod>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processMethod(path, node) {
    const name = t.isStringLiteral(path.node.key) ? path.node.key.value : path.node.key['name'];
    const docs = this.getJSDocs(path);

    let value;
    if (path.node.kind === 'get') {
      value = path.node.returnType
        ? // @ts-ignore
          this.processExport(path.get('returnType.typeAnnotation'))
        : {type: 'any'};
    } else if (path.node.kind === 'set') {
      value =
        path.node.params[0] && path.node.params[0]['typeAnnotation']
          ? // @ts-ignore
            this.processExport(path.get('params.0.typeAnnotation.typeAnnotation'))
          : {type: 'any'};
    } else {
      value = {
        type: 'function',
        // @ts-ignore
        parameters: path.get('params').map((p) => this.processParameter(p)),
        return: path.node.returnType
          ? // @ts-ignore
            this.processExport(path.get('returnType.typeAnnotation'))
          : {type: 'void'},
        typeParameters: path.node.typeParameters
          ? // @ts-ignore
            path.get('typeParameters.params').map((p) => this.processExport(p))
          : [],
      };
    }

    return Object.assign(
      node,
      this.addDocs(
        {
          type: value.type === 'function' ? 'method' : 'property',
          name,
          value,
          access: path.node['accessibility'],
        },
        docs
      )
    );
  }

  /**
   * EX:
   * - foo(...) {...}
   * - declare foo(...) {...}
   *
   * @param {NodePath<t.Function | t.TSDeclareFunction>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processFunction(path, node) {
    if (this.isReactComponent(path)) {
      const props = path.node.params[0];
      const ref = path.node.params[1];
      const docs = this.getJSDocs(path);
      return Object.assign(node, {
        type: 'component',
        id: 'id' in path.node && path.node.id != null ? `${this.filePath}:${path.node.id.name}` : null,
        name: 'id' in path.node && path.node.id ? path.node.id.name : null,
        props:
          props?.['typeAnnotation'] != null
            ? // @ts-ignore
              this.processExport(path.get('params.0.typeAnnotation.typeAnnotation'))
            : null,
        typeParameters: path.node.typeParameters
          ? // @ts-ignore
            path.get('typeParameters.params').map((p) => this.processExport(p))
          : [],
        ref: ref?.['typeAnnotation']
          ? // @ts-ignore
            this.processExport(path.get('params.1.typeAnnotation.typeAnnotation'))
          : null,
        description: docs.description || null,
      });
    } else {
      const docs = this.getJSDocs(path);
      return Object.assign(
        node,
        this.addDocs(
          {
            type: 'function',
            id: 'id' in path.node && path.node.id ? `${this.filePath}:${path.node.id.name}` : undefined,
            name: 'id' in path.node && path.node.id ? path.node.id.name : undefined,

            // @ts-ignore
            parameters: path.get('params').map((p) => this.processParameter(p)),
            return: path.node.returnType
              ? // @ts-ignore
                this.processExport(path.get('returnType.typeAnnotation'))
              : {type: 'any'},
            typeParameters: path.node.typeParameters
              ? // @ts-ignore
                path.get('typeParameters.params').map((p) => this.processExport(p))
              : [],
          },
          docs
        )
      );
    }
  }

  /**
   * Any non-keyword, non-literal type annotation value.
   * EX:
   * - foo
   * - String (not string)
   * - T
   * - Array<string>
   * - React
   * - React.Ref
   *
   * @param {NodePath<t.TSTypeReference>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeReference(path, node) {
    // Array<string>, Ref<T>
    if (path.node.typeParameters) {
      const base = this.processExport(path.get('typeName'));

      // @ts-ignore
      const typeParameters = path.get('typeParameters.params').map((p) => this.processExport(p));
      return Object.assign(node, {
        type: 'application',
        base,
        typeParameters,
      });
    }

    const base = this.processExport(path.get('typeName'), node);
    return base;
  }

  /**
   * EX: React.Ref, specifically used as a type annotation
   *
   * @param {NodePath<t.TSQualifiedName>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSQualifiedName(path, node) {
    const left = this.processExport(path.get('left'));
    if (left == null) return node;

    if (left.type === 'interface' || left.type === 'object') {
      const property = left.properties[path.node.right.name];
      if (property) {
        return property.value;
      }
    }

    let receiverName = 'unknown';
    if (left.type === 'reference') {
      receiverName = left.local;
    } else if (left.type === 'identifier') {
      receiverName = left.name;
    }

    return Object.assign(node, {
      type: 'identifier',
      name: receiverName + '.' + path.node.right.name,
    });
  }

  /**
   * EX:
   * - import {Foo} from 'foo';
   * - import Foo from 'foo';
   * - import * as Foo from 'foo';
   *
   * @param {NodePath<t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processImportSpecifier(path, node) {
    if (!('source' in path.parent) || path.parent.source == null) return node;

    const specifier = path.parent.source.value;
    const local = path.node.local.name;
    let imported;
    if (path.isImportSpecifier()) {
      imported = path.node.imported['name'];
    } else if (path.isImportDefaultSpecifier()) {
      imported = 'default';
    } else if (path.isImportNamespaceSpecifier()) {
      imported = '*';
    }

    this.addDependency(specifier, new Map([[local, imported]]));

    return Object.assign(node, {
      type: 'reference',
      local,
      imported,
      specifier,
    });
  }

  /**
   * EX: type Foo = ...;
   *
   * @param {NodePath<t.TSTypeAliasDeclaration>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeAliasDeclaration(path, node) {
    const docs = this.getJSDocs(path);
    return Object.assign(node, {
      type: 'alias',
      id: `${this.filePath}:${path.node.id.name}`,
      name: path.node.id.name,
      value: this.processExport(path.get('typeAnnotation')),
      typeParameters: path.node.typeParameters
        ? // @ts-ignore
          path.get('typeParameters.params').map((p) => this.processExport(p))
        : [],
      description: docs.description || null,
      access: docs.access,
    });
  }

  /**
   * EX: interface Foo {}
   *
   * @param {NodePath<t.TSInterfaceDeclaration>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSInterfaceDeclaration(path, node) {
    /** @type {Record<string, Node>} */
    const properties = {};
    /** @type {NodePath<t.TSInterfaceBody['body'][number]>[]} */
    // @ts-ignore the type is definitely what's above
    const bodyNodes = path.get('body.body');

    for (const propertyPath of bodyNodes) {
      // Only supporting these kinds of nodes.
      // TSConstructSignatureDeclaration and TSCallSignatureDeclaration _exist_,
      // but idk how to even encounter them, so this is fine for now.
      if (!['TSPropertySignature', 'TSMethodSignature', 'TSIndexSignature'].includes(propertyPath.node.type)) continue;

      const property = this.processExport(propertyPath);
      if (property) {
        const prev = properties[property.name];
        if (!property.description && prev?.description) {
          property.description = prev.description;
        }
        properties[property.name] = property;
      } else {
        console.log('UNKNOWN PROPERTY interface declaration', propertyPath.node);
      }
    }

    // @ts-ignore
    const exts = path.node.extends ? path.get('extends').map((e) => this.processExport(e)) : [];
    const docs = this.getJSDocs(path);

    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'interface',
          id: `${this.filePath}:${path.node.id.name}`,
          name: path.node.id.name,
          extends: exts,
          // @ts-ignore enforcing this is property | method with the type check in the loop above.
          properties,
          typeParameters: path.node.typeParameters
            ? // @ts-ignore
              path.get('typeParameters.params').map((p) => this.processExport(p))
            : [],
        },
        docs
      )
    );
  }

  /**
   * EX:
   *  - enum Foo {}
   *
   * @param {NodePath<t.TSEnumDeclaration>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSEnumDeclaration(path, node) {
    const members = [];
    for (const member of path.get('members')) {
      const property = this.processExport(member);
      if (property) {
        members.push(property);
      } else {
        console.log('UNKNOWN PROPERTY (enum declaration)', member.node);
      }
    }

    return Object.assign(node, {
      type: 'enum',
      name: path.node.id.name,
      members,
    });
  }

  /**
   * EX: Inside an enum declaration
   *  - A
   *  - B = 1
   *  - C = 'foo'
   *
   * @param {NodePath<t.TSEnumMember>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSEnumMember(path, node) {
    const initializer = path.get('initializer');
    // If no initializer is given, the value is explicitly null, not undefined.
    let value = null;
    if (initializer.isStringLiteral()) {
      value = initializer.node.value;
    } else if (initializer.isNumericLiteral()) {
      value = String(initializer.node.value);
    }

    return Object.assign(node, {
      type: 'enumMember',
      name: path.node.id['name'],
      value,
    });
  }

  /**
   * Object literals used as types.
   *
   * EX:
   *  - {}
   *  - {foo: string}
   *  - {foo: string, bar: number}
   *
   * @param {NodePath<t.TSTypeLiteral>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeLiteral(path, node) {
    const properties = {};
    for (const member of path.get('members')) {
      const property = this.processExport(member);
      if (property) {
        properties[property.name] = property;
      } else {
        console.log('UNKNOWN PROPERTY (type literal)', member.node);
      }
    }

    return Object.assign(node, {
      type: 'object',
      properties,
    });
  }

  /**
   * NOTE: For some reason `keyof` is handled separately later on...except
   * it's not cause this happens first.
   *
   * EX:
   *  - typeof
   *  - keyof
   *  - unique
   *
   * @param {NodePath<t.TSTypeOperator>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeOperator(path, node) {
    return Object.assign(node, {
      type: 'typeOperator',
      operator: path.node.operator,
      value: this.processExport(path.get('typeAnnotation')),
    });
  }

  /**
   * When `typeof` is used as a type annotation, it's called a `TSTypeQuery`
   * rather than a `TSTypeOperator`, but we can handle them the same way.
   *
   * EX: foo: typeof T;
   *
   * @param {NodePath<t.TSTypeQuery>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeQuery(path, node) {
    return Object.assign(node, {
      type: 'typeOperator',
      operator: 'typeof',
      value: this.processExport(path.get('exprName')),
    });
  }

  /**
   * `this`, but specifically when used as a type annotation.
   * EX:
   * - foo: this
   *
   * @param {NodePath<t.TSThisType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSThisType(path, node) {
    return Object.assign(node, {
      type: 'this',
    });
  }

  /**
   * EX:
   * - foo: string
   * - 'aria-label': string
   * - 123: string
   *
   * @param {NodePath<t.TSPropertySignature>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSPropertySignature(path, node) {
    let name;
    if (t.isStringLiteral(path.node.key)) {
      name = path.node.key.value;
    } else if (t.isNumericLiteral(path.node.key)) {
      name = String(path.node.key.value);
    } else if (t.isIdentifier(path.node.key)) {
      name = path.node.key.name;
    } else {
      console.log('Unknown key', path.node.key);
      name = 'unknown';
    }

    const docs = this.getJSDocs(path);

    // @ts-ignore
    const value = this.processExport(path.get('typeAnnotation.typeAnnotation'));
    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'property',
          name,
          value,
          optional: path.node.optional || false,
        },
        docs
      )
    );
  }

  /**
   * Functions declared with the shorthand syntax on an interface.
   *
   * EX:
   * - foo(): void
   *
   * @param {NodePath<t.TSMethodSignature>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSMethodSignature(path, node) {
    const name = t.isStringLiteral(path.node.key)
      ? path.node.key.value
      : // @ts-expect-error `path.node.key` _could_ be an arbitrary expression, but isn't.
        path.node.key.name;
    const docs = this.getJSDocs(path);
    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'method',
          name,
          value: {
            type: 'function',
            parameters: path.get('parameters').map((p) => this.processParameter(p)),
            return: path.node.typeAnnotation
              ? // @ts-ignore
                this.processExport(path.get('typeAnnotation.typeAnnotation'))
              : {type: 'any'},
            typeParameters: path.node.typeParameters
              ? // @ts-ignore
                path.get('typeParameters.params').map((p) => this.processExport(p))
              : [],
          },
        },
        docs
      )
    );
  }

  /**
   * EX:
   * - {[index: number]: Foo}
   * - {[P in keyof T]: T[P]}
   *
   * @param {NodePath<t.TSIndexSignature>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSIndexSignature(path, node) {
    const name = path.node.parameters[0].name;
    const docs = this.getJSDocs(path);
    return Object.assign(
      node,
      this.addDocs(
        {
          type: 'property',
          name,
          // @ts-ignore
          indexType: this.processExport(path.get('parameters.0.typeAnnotation.typeAnnotation')),
          // @ts-ignore
          value: this.processExport(path.get('typeAnnotation.typeAnnotation')),
        },
        docs
      )
    );
  }

  /**
   * This is _not_ a call expression. It's specifically a regular expression
   * amended with type arguments.
   *
   * EX:
   * - foo<T, K>
   * - foo.bar.baz<T, K>
   *
   * @param {NodePath<t.TSExpressionWithTypeArguments>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSExpressionWithTypeArguments(path, node) {
    if (path.node.typeParameters) {
      return Object.assign(node, {
        type: 'application',
        base: this.processExport(path.get('expression')),
        // @ts-ignore
        typeParameters: path.get('typeParameters.params').map((p) => this.processExport(p)),
      });
    }

    return this.processExport(path.get('expression'), node);
  }

  /**
   * EX: variableName
   *
   * @param {NodePath<t.Identifier>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processIdentifier(path, node) {
    // Match imported types/values and local JS values.
    const binding = path.scope.getBinding(path.node.name);
    if (binding != null) {
      return this.processExport(binding.path, node);
    }
    // Then lookup locally-defined types that don't have JS values.
    // Ignoring for now because this somehow doesn't end up making a `link`
    // and means the resolver shows `unknown` instead of a name.
    const globalType = this.globalTypes.get(path.node.name);
    if (globalType != null) {
      // If it was, just process the export, but don't do anything with it.
      return this.processExport(globalType, node);
    }

    // Otherwise just say it's an unknown identifier.
    return Object.assign(node, {
      type: 'identifier',
      name: path.node.name,
    });
  }

  /**
   * EX: string[]
   *
   * @param {NodePath<t.TSArrayType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSArrayType(path, node) {
    return Object.assign(node, {
      type: 'array',
      elementType: this.processExport(path.get('elementType')),
    });
  }

  /**
   * EX: 'a' | 'b'
   *
   * @param {NodePath<t.TSUnionType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSUnionType(path, node) {
    return Object.assign(node, {
      type: 'union',
      elements: path.get('types').map((t) => this.processExport(t)),
    });
  }

  /**
   * Any TypeScript literal, including string template literals, specifically
   * when used as a type annotation.
   *
   * EX:
   * - 1
   * - 'foo'
   * - false
   * - undefined
   * - `events.${EventTypes}`
   *
   * @param {NodePath<t.TSLiteralType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSLiteralType(path, node) {
    if (t.isTemplateLiteral(path.node.literal)) {
      // @ts-ignore
      const expressions = path.get('literal.expressions').map((e) => this.processExport(e));
      /** @type {Node[]} */
      const elements = [];
      let i = 0;
      for (const q of path.node.literal.quasis) {
        if (q.value.raw) {
          elements.push({
            type: 'string',
            value: q.value.raw,
          });
        }

        if (!q.tail) {
          elements.push(expressions[i++]);
        }
      }

      return Object.assign(node, {
        type: 'template',
        elements,
      });
    }

    // @ts-expect-error `path.node.literal` _could_ be a UnaryExpression...if it wasn't a type literal.
    const value = path.node.literal.value;

    return Object.assign(node, {
      type: typeof value,
      value,
    });
  }

  /**
   * Unnamed functions type declarations, not actual functions.
   *
   * EX:
   * - (...): void
   * - constructor(...): void
   *
   * @param {NodePath<t.TSFunctionType | t.TSConstructorType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSFunctionType(path, node) {
    return Object.assign(node, {
      type: 'function',
      parameters: path.get('parameters').map((p) => this.processParameter(p)),
      return: path.node.typeAnnotation
        ? // @ts-ignore
          this.processExport(path.get('typeAnnotation.typeAnnotation'))
        : {type: 'any'},
      typeParameters: path.node.typeParameters
        ? // @ts-ignore
          path.get('typeParameters.params').map((p) => this.processExport(p))
        : [],
    });
  }

  /**
   * EX: {a: string} & {a: number}
   *
   * @param {NodePath<t.TSIntersectionType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSIntersectionType(path, node) {
    return Object.assign(node, {
      type: 'intersection',
      types: path.get('types').map((p) => this.processExport(p)),
    });
  }

  /**
   * EX: The `T` inside of a generic expression, like Array<T>.
   *
   * @param {NodePath<t.TSTypeParameter>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSTypeParameter(path, node) {
    return Object.assign(node, {
      type: 'typeParameter',
      name: path.node.name,
      // @ts-ignore
      constraint: path.node.constraint ? this.processExport(path.get('constraint')) : null,
      // @ts-ignore
      default: path.node.default ? this.processExport(path.get('default')) : null,
    });
  }

  /**
   * EX: [string, boolean, number]
   *
   * @param {NodePath<t.TSTupleType>} path
   * @param {PartialNode} node
   */
  processTSTupleType(path, node) {
    return Object.assign(node, {
      type: 'tuple',
      elements: path.get('elementTypes').map((t) => this.processExport(t)),
    });
  }

  /**
   * EX: keyof Types
   *
   * @param {NodePath<t.TSTypeOperator>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processKeyofOperator(path, node) {
    return Object.assign(node, {
      type: 'keyof',
      keyof: this.processExport(path.get('typeAnnotation')),
    });
  }

  /**
   * EX: T extends string ? A : B
   *
   * @param {NodePath<t.TSConditionalType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSConditionalType(path, node) {
    return Object.assign(node, {
      type: 'conditional',
      checkType: this.processExport(path.get('checkType')),
      extendsType: this.processExport(path.get('extendsType')),
      trueType: this.processExport(path.get('trueType')),
      falseType: this.processExport(path.get('falseType')),
    });
  }

  /**
   * EX: module Foo {}
   *
   * @param {NodePath<t.TSModuleDeclaration>} _path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSModuleDeclaration(_path, node) {
    // TODO: decide how we want to display something from a Global namespace
    return node;
  }

  /**
   * EX: Props['color']
   *
   * @param {NodePath<t.TSIndexedAccessType>} path
   * @param {PartialNode} node
   * @returns {PartialNode}
   */
  processTSIndexedAccessType(path, node) {
    return Object.assign(node, {
      type: 'indexedAccess',
      objectType: this.processExport(path.get('objectType')),
      indexType: this.processExport(path.get('indexType')),
    });
  }
};
