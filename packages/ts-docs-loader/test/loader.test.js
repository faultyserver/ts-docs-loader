// @ts-check

import {test} from '@jest/globals';
import assert from 'node:assert/strict';
import compiler, {createFiles} from './compiler.js';
import {Stats} from 'webpack';

function prettyJSON(object) {
  if (typeof object == 'string') {
    object = JSON.parse(object);
  }
  return JSON.stringify(object, null, 2);
}

/**
 * Return the JSON result of the entrypoing file from running the loader.
 *
 * @param {Stats | undefined} stats
 * @returns {{exports: object, links: object}}
 */
function getEntrypointOutput(stats) {
  const output = stats?.toJson({source: true}).modules?.map((mod) => mod.source);
  const entryFileOutput = output?.[0] ?? '';
  return JSON.parse(entryFileOutput.slice('export default '.length, -1).toString());
}

test('exporting from another file', async () => {
  const fs = createFiles({
    '/base': `
      export interface Base {
        value: number;
      }
    `,
    '/index': `
      import { Base } from "./base";

      export {Base};
    `,
  });
  const stats = await compiler(fs);
  const data = getEntrypointOutput(stats);
  assert(data.exports['Base'] instanceof Object);
});

test('immediately rejects build if dependency cannot be resolved', async () => {
  const fs = createFiles({
    '/index': `export {F} from 'foo';`,
  });

  assert.rejects(compiler(fs));
});

test('skips unused dependencies', async () => {
  // Without symbol-level dependency tracking, the loader won't know that `F`
  // isn't needed to resolve all of the exports in the file, so it will try to
  // import and process it.
  //
  // With tracking, the import can be skipped, reducing the scope of processed
  // files, and limiting chances to encounter unnecessary errors.
  const fs = createFiles({
    '/index': `
      import {F} from 'foo';
      export interface Base {
        value: number;
      }
    `,
  });
  const stats = await compiler(fs);
  const data = getEntrypointOutput(stats);
  assert(data.exports['Base'] instanceof Object);
});
