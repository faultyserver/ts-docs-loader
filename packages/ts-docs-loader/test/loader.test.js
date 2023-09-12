// @ts-check

import {describe, test, jest} from '@jest/globals';
import assert from 'node:assert/strict';
import {Stats} from 'webpack';

import compiler, {createFS} from './compiler.js';
import {assertNodeContent} from './util.js';
import {beforeEach} from 'node:test';

const {fs, volume} = createFS();

jest.setMock('fs', fs);

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

beforeEach(() => {
  volume.reset();
});

test('exporting from another file', async () => {
  volume.fromJSON({
    '/base': `
      export interface Base {
        value: number;
      }
    `,
    '/index': `
      import { Base } from "/base";

      export {Base};
    `,
  });
  const stats = await compiler();
  const data = getEntrypointOutput(stats);

  assert(data.exports['Base'] instanceof Object);
});

test('immediately rejects build if dependency cannot be resolved', async () => {
  volume.fromJSON({
    '/index': `export {F} from 'foo';`,
  });

  assert.rejects(compiler());
});

test('skips unused dependencies', async () => {
  // Without symbol-level dependency tracking, the loader won't know that `F`
  // isn't needed to resolve all of the exports in the file, so it will try to
  // import and process it.
  //
  // With tracking, the import can be skipped, reducing the scope of processed
  // files, and limiting chances to encounter unnecessary errors.
  volume.fromJSON({
    '/index': `
      import {F} from 'foo';
      export interface Base {
        value: number;
      }
    `,
  });
  const stats = await compiler();
  const data = getEntrypointOutput(stats);
  assert(data.exports['Base'] instanceof Object);
});

describe.skip('barrel imports', () => {
  // This really just checks that it doesn't timeout. No actual assertion.
  test(`doesn't hang indefinitely when encountering a circle`, async () => {
    const fs = createFiles({
      '/a': `import {b} from './b'; export const a = 1;`,
      '/b': `import {a} from './a'; export const b = 2;`,
      '/index': `import {a} from './a';`,
    });
    await compiler(fs);
  });

  test('resolves exports through barrels', async () => {
    const fs = createFiles({
      '/a': `
        export const a = 1;
      `,
      '/barrel': `
        export {a} from './a';
      `,
      '/index': `export {a} from './a';`,
    });
    const stats = await compiler(fs);
    const data = getEntrypointOutput(stats);

    assertNodeContent(data.exports['a'], {name: 'a', type: 'number', value: '1'});
  });

  test('gracefully handles circular declarations', async () => {
    const fs = createFiles({
      '/foo': `
        import {Bar} from './barrel';
        export const Foo = Bar;
      `,
      '/bar': `
        import {Foo} from './barrel';
        export type Bar = Foo;
      `,
      '/barrel': `
        export {Foo} from './foo';
        export {Bar} from './bar';
      `,
      '/index': `export {Bar} from './barrel';`,
    });
    const stats = await compiler(fs);
    const data = getEntrypointOutput(stats);

    assert('Bar' in data.exports);
    assertNodeContent(data.exports['Bar'], {id: '/bar:Bar', type: 'link'});
  });
});
