// @ts-check

import {test} from '@jest/globals';
import assert from 'node:assert/strict';
import {Stats} from 'webpack';

import compiler, {createFixtures} from './compiler.js';

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
