import {describe, test} from '@jest/globals';
import assert from 'node:assert/strict';

import {NodeResolver} from '../src/evaluator/nodeResolver';
import {performOmit} from '../src/evaluator/omit';

/**
 * @typedef {import('@faulty/ts-docs-node-types').InterfaceNode} InterfaceNode
 * @typedef {import('@faulty/ts-docs-node-types').UnionNode} UnionNode
 */

/**
 * @param {string} node
 * @param {Record<string, string>} nodes Map of property names to their type
 * @returns {InterfaceNode}
 */
function makeInterface(name, nodes) {
  return {
    type: 'interface',
    id: name,
    name,
    extends: [],
    properties: Object.fromEntries(
      Object.entries(nodes).map(([name, valueType]) => [
        name,
        {
          type: 'property',
          name,
          value: {type: valueType},
          optional: false,
        },
      ]),
    ),
    typeParameters: [],
  };
}

function makeResolver(nodes = {}) {
  return new NodeResolver(nodes, {}, {});
}

const b = {
  str: (value) => (value == null ? {type: 'string'} : {type: 'string', value}),
  num: (value) => (value == null ? {type: 'number'} : {type: 'number', value}),
  bool: (value) => (value == null ? {type: 'boolean'} : {type: 'boolean', value}),
  union: (elements) => ({type: 'union', elements}),
  alias: (name, value, typeParameters = []) => ({
    type: 'alias',
    id: name,
    name,
    value,
    typeParameters,
  }),
  interface: (name, properties, extensions = [], typeParameters = []) => ({
    type: 'interface',
    id: name,
    name,
    extends: extensions,
    properties,
    typeParameters,
  }),
};

describe('Omit', () => {
  const Foo = b.interface('Foo', {
    foo: b.str(),
    bar: b.str(),
    baz: b.num(),
    onChange: b.str(),
    onClick: b.str(),
    className: b.str(),
    style: b.str(),
  });

  const resolver = makeResolver({Foo});

  test('removes single key from object type', () => {
    const keys = b.union([b.str('bar')]);

    const result = performOmit(resolver, Foo, keys);
    // Assert only one element was removed
    assert(Object.keys(result.properties).length === Object.keys(Foo.properties).length - 1);
    assert(!('bar' in result.properties));
  });

  test('removes multiple keys from object type', () => {
    const keys = b.union([b.str('foo'), b.str('bar')]);

    const result = performOmit(resolver, Foo, keys);

    assert(Object.keys(result.properties).length === Object.keys(Foo.properties).length - 2);
    assert(!('foo' in result.properties));
    assert(!('bar' in result.properties));
  });

  test('traverses aliases to resolve union elements', () => {
    const HandlersAlias = b.alias('Handlers', b.union([b.str('onChange'), b.str('onClick')]));
    const keys = b.union([HandlersAlias, b.str('bar')]);

    const result = performOmit(resolver, Foo, keys);
    // Assert only one element was removed
    assert(Object.keys(result.properties).length === Object.keys(Foo.properties).length - 3);
    assert(!('onChange' in result.properties));
    assert(!('onClick' in result.properties));
    assert(!('bar' in result.properties));
  });
});
