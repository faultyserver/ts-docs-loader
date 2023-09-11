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
