import {describe, test} from '@jest/globals';
import assert from 'node:assert/strict';

import NodeResolver from '../src/evaluator/nodeResolver';
import performOmit from '../src/evaluator/omit';

import {builder as b} from './nodeBuilder';

function makeResolver(nodes = {}) {
  return new NodeResolver(nodes, {}, {});
}

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
