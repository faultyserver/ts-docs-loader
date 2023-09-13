// @ts-check

import {describe, test} from '@jest/globals';
import assert from 'node:assert/strict';

import {assertNodeContent} from './util.js';
import {createTestLoader} from './createTestLoader.js';

test('exporting from another file', async () => {
  const loader = createTestLoader({
    base: `
      export interface Base {
        value: number;
      }
    `,
    index: `
      export { Base } from "base";
    `,
  });
  const data = await loader('index');
  assert(data.exports['Base'] instanceof Object);
});

test('renaming an export', async () => {
  const loader = createTestLoader({
    base: `
      export interface Base {
        value: number;
      }
    `,
    index: `
      export {Base as Foo} from "base";
    `,
  });
  const data = await loader('index');
  assert(!('Base' in data.exports));
  assert(data.exports['Foo'] instanceof Object);
});

test('exporting an import separately', async () => {
  const loader = createTestLoader({
    base: `
      export interface Base {
        value: number;
      }
    `,
    index: `
      import {Base} from "base";
      export {Base as Foo};
    `,
  });
  const data = await loader('index');
  assert(data.exports['Foo'] instanceof Object);
});

test('proxying an import through an intermediate type', async () => {
  const loader = createTestLoader({
    base: `
      export interface Base {
        value: number;
      }
    `,
    index: `
      import {Base} from "base";
      type Foo = Base;
      export {Foo};
    `,
  });
  const data = await loader('index');
  assert(data.exports['Foo'] instanceof Object);
});

test('skips unused dependencies', async () => {
  // If dependencies aren't skipped, this would fail, since 'foo' does not exist.
  const loader = createTestLoader({
    index: `
      import {F} from 'foo';
      export interface Base {
        value: number;
      }
    `,
  });
  const data = await loader('index');
  assert(data.exports['Base'] instanceof Object);
});

test('skips unrequested exports', async () => {
  // When a loader request only asks for certain symbols, it should completely
  // skip anything that's not depended on. This barrel exports from non-existent
  // files, but because they aren't requested, the files don't get looked up
  // and fail. If they weren't skipped, it would fail.
  const loader = createTestLoader({
    foo: `export interface Foo {};`,
    barrel: `
      export {Bar} from 'bar';
      export {Foo} from 'foo';
    `,
    index: `
      export {Foo} from 'barrel';
    `,
  });
  const data = await loader('index');
  assert(data.exports['Foo'] instanceof Object);
});

test('handles * exports mixed with named exports', async () => {
  // When a loader request only asks for certain symbols, it should completely
  // skip anything that's not depended on. This barrel exports from non-existent
  // files, but because they aren't requested, the files don't get looked up
  // and fail. If they weren't skipped, it would fail.
  const loader = createTestLoader({
    foo: `export interface Foo {};`,
    barrel: `
      export {Foo} from 'foo';
    `,
    index: `
      export * from 'barrel';
      export {Foo as Bar} from 'barrel';
    `,
  });
  const data = await loader('index');
  // The renamed export should exist
  assert(data.exports['Bar'] instanceof Object);
  assert(data.exports['Bar']['id'] == 'foo:Foo');
  // But the passthrough from the wildcard should also be there.
  assert(data.exports['Foo'] instanceof Object);
});

describe('barrel imports', () => {
  // This really just checks that it doesn't timeout. No actual assertion.
  test(`doesn't hang indefinitely when encountering a circle`, async () => {
    const loader = createTestLoader({
      a: `import {b} from 'b'; export const a = 1;`,
      b: `import {a} from 'a'; export const b = 2;`,
      index: `import {a} from 'a';`,
    });
    await loader('index');
  });

  test('resolves exports through barrels', async () => {
    const loader = createTestLoader({
      a: `
        export const a = 1;
      `,
      barrel: `
        export {a} from 'a';
      `,
      index: `export {a} from 'a';`,
    });

    const data = await loader('index');
    assertNodeContent(data.exports['a'], {name: 'a', type: 'number', value: '1'});
  });

  test('gracefully handles circular declarations', async () => {
    const loader = createTestLoader({
      foo: `
        import {Bar} from 'barrel';
        export const Foo = Bar;
      `,
      bar: `
        import {Foo} from 'barrel';
        export type Bar = Foo;
      `,
      barrel: `
        export {Foo} from 'foo';
        export {Bar} from 'bar';
      `,
      index: `export {Foo, Bar} from 'barrel';`,
    });
    const data = await loader('index');

    assert('Bar' in data.exports);
    assert('Foo' in data.exports);
    assertNodeContent(data.exports['Bar'], {id: `bar:Bar`, type: 'link'});
  });
});
