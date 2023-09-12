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

test('skips unused dependencies', async () => {
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
