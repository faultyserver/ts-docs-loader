// @ts-check

import {describe, test, expect} from '@jest/globals';
import assert from 'node:assert/strict';
import {Stats} from 'webpack';

import compiler, {createFixtures} from './compiler.js';
import {assertNodeContent} from './util.js';

/**
 * Return the JSON result of the entrypoing file from running the loader.
 *
 * @param {Stats | undefined} stats
 * @returns {{exports: object, links: object}}
 */
function getEntrypointOutput(stats) {
  const output = stats?.toJson({source: true}).modules?.map((mod) => mod.source);
  const entryFileOutput = output?.[0] ?? '';
  return JSON.parse(entryFileOutput.toString().slice('export default '.length, -1));
}

test('exporting from another file', async () => {
  const fixtures = createFixtures({
    'base.tsx': `
      export interface Base {
        value: number;
      }
    `,
    'index.tsx': `
      export { Base } from "./base";
    `,
  });
  const stats = await compiler(fixtures['index.tsx']);
  const data = getEntrypointOutput(stats);
  assert(data.exports['Base'] instanceof Object);
});

test('skips unused dependencies', async () => {
  // Without symbol-level dependency tracking, the loader won't know that `F`
  // isn't needed to resolve all of the exports in the file, so it will try to
  // import and process it.
  //
  // With tracking, the import can be skipped, reducing the scope of processed
  // files, and limiting chances to encounter unnecessary errors.
  const fixtures = createFixtures({
    'index.tsx': `
      import {F} from 'foo';
      export interface Base {
        value: number;
      }
    `,
  });
  const stats = await compiler(fixtures['index.tsx']);
  const data = getEntrypointOutput(stats);
  assert(data.exports['Base'] instanceof Object);
});

describe('barrel imports', () => {
  // This really just checks that it doesn't timeout. No actual assertion.
  test(`doesn't hang indefinitely when encountering a circle`, async () => {
    const fixtures = createFixtures({
      'a.tsx': `import {b} from './b'; export const a = 1;`,
      'b.tsx': `import {a} from './a'; export const b = 2;`,
      'index.tsx': `import {a} from './a';`,
    });
    await compiler(fixtures['index.tsx']);
  });

  test('resolves exports through barrels', async () => {
    const fixtures = createFixtures({
      'a.tsx': `
        export const a = 1;
      `,
      'barrel.tsx': `
        export {a} from './a';
      `,
      'index.tsx': `export {a} from './a';`,
    });
    const stats = await compiler(fixtures['index.tsx']);
    const data = getEntrypointOutput(stats);

    assertNodeContent(data.exports['a'], {name: 'a', type: 'number', value: '1'});
  });

  test('gracefully handles circular declarations', async () => {
    const fixtures = createFixtures({
      'foo.tsx': `
        import {Bar} from './barrel';
        export const Foo = Bar;
      `,
      'bar.tsx': `
        import {Foo} from './barrel';
        export type Bar = Foo;
      `,
      'barrel.tsx': `
        export {Foo} from './foo';
        export {Bar} from './bar';
      `,
      'index.tsx': `export {Bar} from './barrel';`,
    });
    const stats = await compiler(fixtures['index.tsx']);
    const data = getEntrypointOutput(stats);

    assert('Bar' in data.exports);
    assertNodeContent(data.exports['Bar'], {id: `${fixtures['bar.tsx']}:Bar`, type: 'link'});
  });
});
