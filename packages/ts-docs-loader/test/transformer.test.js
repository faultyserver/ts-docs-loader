// @ts-check
import assert, {fail} from 'node:assert/strict';
import {NodePath} from '@babel/traverse';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import {describe, test} from '@jest/globals';

import Transformer from '../src/transformer.js';
import {assertNodeContent} from '../test/util.js';

/**
 * @typedef {import('@babel/types').Node} Node
 */

function getTransformer() {
  return new Transformer('mem');
}

function parseCode(source) {
  return parse(source, {
    allowReturnOutsideFunction: true,
    strictMode: false,
    sourceType: 'module',
    plugins: [
      'classProperties',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'dynamicImport',
      'typescript',
      'jsx',
      'classPrivateProperties',
      'classPrivateMethods',
    ],
  });
}

/**
 * @template {keyof import('@babel/traverse').Visitor} T
 * @param {string} source Source code to transform
 * @param {T} expressionType
 * @returns {import('@babel/traverse').NodePath<Extract<Node, {type: T}>>} */
function parseSingleExpression(source, expressionType) {
  const ast = parseCode(source);
  /** @type {import('@babel/traverse').NodePath | null} */
  let result = null;

  traverse(ast, {
    [expressionType](path) {
      result = path;
      return false;
    },
  });

  if (result == null) fail(`Unable to parse single ${expressionType} from source`);
  return result;
}

/**
 * Force `path.get` to resolve to a non-nullable entity, so that it can be
 * passed to `transformer.processExport` without a type error.
 *
 * This function doesn't actually do anything, it just asserts the type.
 *
 * @template {Node | null | undefined} T
 * @param {NodePath<T>} t
 * @returns {NodePath<Exclude<T, null | undefined>>}
 */
function ensuredPath(t) {
  // @ts-ignore this is intentionally narrowing unsafely.
  return t;
}

/**
 * Return a full ID for the given name. This just prepends the default
 * transformer's filePath to the name, matching its internal behavior.
 * @param {string} name
 */
function makeId(name) {
  return `mem:${name}`;
}

describe('Transformer', () => {
  test('empty interface', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export interface Foo {}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {
      type: 'interface',
      name: 'Foo',
      id: makeId('Foo'),
      extends: [],
      typeParameters: [],
      properties: {},
    });
  });

  test('extending interface', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export interface Foo extends Bar {}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {extends: [{type: 'identifier', name: 'Bar'}]});
  });

  test('plain enum', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export enum Bar { A, B}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {
      type: 'enum',
      name: 'Bar',
    });
    assert(output.members.length === 2);
    assertNodeContent(output.members[0], {name: 'A', value: null});
    assertNodeContent(output.members[1], {name: 'B', value: null});
  });

  test('enum with numeric values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export enum Bar { A = 1, B, C = 2}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {type: 'enum', name: 'Bar'});
    assert(output.members.length === 3);

    assertNodeContent(output.members[0], {name: 'A', value: '1'});
    assertNodeContent(output.members[1], {name: 'B', value: null});
    assertNodeContent(output.members[2], {name: 'C', value: '2'});
  });

  test('enum with string values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression("export enum Bar { A = 'foo', B = 'bar'}", 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {type: 'enum', name: 'Bar'});
    assert(output.members.length === 2);
    assertNodeContent(output.members[0], {name: 'A', value: 'foo'});
    assertNodeContent(output.members[1], {name: 'B', value: 'bar'});
  });

  test('enum with mixed values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression("export enum Bar { A = 1, B = 'two'}", 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assertNodeContent(output, {type: 'enum', name: 'Bar'});
    assert(output.members.length === 2);
    assertNodeContent(output.members[0], {name: 'A', value: '1'});
    assertNodeContent(output.members[1], {name: 'B', value: 'two'});
  });

  describe('processVariableDeclarator', () => {
    test('handles initialized variable', () => {
      const transformer = getTransformer();
      const path = parseSingleExpression('const foo = 2', 'VariableDeclarator');

      assertNodeContent(transformer.processExport(path), {type: 'number', name: 'foo', value: '2'});
    });

    test('returns empty for non-initialized variables', () => {
      const transformer = getTransformer();
      const path = parseSingleExpression('let foo;', 'VariableDeclarator');

      assert.deepEqual(transformer.processExport(path), {});
    });

    test('treats object expressions as interfaces', () => {
      const transformer = getTransformer();
      const path = parseSingleExpression(`const foo = {a: 'hi'};`, 'VariableDeclarator');
      const output = transformer.processExport(path);

      assertNodeContent(output, {type: 'interface', name: 'foo'});
      assertNodeContent(output.properties['a'], {type: 'property', name: 'a'});
      assertNodeContent(output.properties['a'].value, {type: 'string', value: 'hi'});
    });
  });
});
