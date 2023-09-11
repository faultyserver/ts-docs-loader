// @ts-check
import {describe, test} from '@jest/globals';
import assert, {fail} from 'node:assert/strict';

import {parse} from '@babel/parser';
import traverse from '@babel/traverse';

import Transformer from './transformer.js';
import {NodePath} from '@babel/traverse';

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
 * @template {Node | null | undefined} T
 * @param {NodePath<T>} t
 * @returns {NodePath<Exclude<T, null | undefined>>}
 */
function ensuredPath(t) {
  // @ts-ignore this is intentionally narrowing unsafely.
  return t;
}

describe('processPath', () => {
  test('empty interface', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export interface Foo {}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.type === 'interface');
    assert(output.name === 'Foo');
    assert.match(output.id, /.+:.+/);
    assert(output.extends instanceof Array);
    assert(output.properties instanceof Object);
    assert(output.typeParameters instanceof Array);
    assert(Object.values(output.properties).length === 0);
  });

  test('extending interface', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export interface Foo extends Bar {}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.extends instanceof Array);
    assert(output.extends.length === 1);
    assert(output.extends[0].type === 'identifier');
    assert(output.extends[0].name === 'Bar');
  });

  test('plain enum', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export enum Bar { A, B}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.type === 'enum');
    assert(output.name === 'Bar');
    assert(output.members[0].name === 'A');
    assert(output.members[0].value === null);
    assert(output.members[1].name === 'B');
    assert(output.members[1].value === null);
  });

  test('enum with numeric values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression('export enum Bar { A = 1, B, C = 2}', 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.type === 'enum');
    assert(output.name === 'Bar');
    assert(output.members.length === 3);
    assert(output.members[0].name === 'A');
    // Numeric literals are saved as string values
    assert(output.members[0].value === '1');
    assert(output.members[1].name === 'B');
    assert(output.members[1].value === null);
    assert(output.members[2].name === 'C');
    assert(output.members[2].value === '2');
  });

  test('enum with string values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression("export enum Bar { A = 'foo', B = 'bar'}", 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.type === 'enum');
    assert(output.name === 'Bar');
    assert(output.members.length === 2);
    assert(output.members[0].name === 'A');
    // Numeric literals are saved as string values
    assert(output.members[0].value === 'foo');
    assert(output.members[1].name === 'B');
    assert(output.members[1].value === 'bar');
  });

  test('enum with mixed values', () => {
    const transformer = getTransformer();
    const path = parseSingleExpression("export enum Bar { A = 1, B = 'two'}", 'ExportNamedDeclaration');
    const output = transformer.processExport(ensuredPath(path.get('declaration')));

    assert(output.type === 'enum');
    assert(output.name === 'Bar');
    assert(output.members.length === 2);
    assert(output.members[0].name === 'A');
    // Numeric literals are saved as string values
    assert(output.members[0].value === '1');
    assert(output.members[1].name === 'B');
    assert(output.members[1].value === 'two');
  });
});
