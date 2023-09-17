// @ts-check

import {test} from '@jest/globals';
import assert from 'node:assert/strict';
import {Stats} from 'webpack';

import compiler, {createFixtures} from './compiler.js';
import path from 'node:path';

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

test('handles looping imports through a barrel', async () => {
  const fixtures = createFixtures({
    'barrel.tsx': `
      export {Bar} from './bar';
      export {Foo} from './foo';
    `,
    'foo.tsx': `
      import {Bar} from './barrel';
      export interface Foo extends Bar {};
    `,
    'bar.tsx': `
      export interface Bar {
        barProp: boolean;
      };
    `,
    'index.tsx': `
      export {Foo} from './barrel';
    `,
  });
  const stats = await compiler(fixtures['index.tsx']);
  const data = getEntrypointOutput(stats);

  assert(data.exports['Foo'] instanceof Object);
  // Testing that the interfaces merged into Foo means that it
  // was able to resolve everything in the chain and not shortcut out.
  assert(data.exports['Foo']['properties']['barProp'] instanceof Object);
});

test('ExampleComponents', async () => {
  const entry = path.resolve(__dirname, '../../../../examples/react-next/components/ExampleComponents.tsx');
  const context = path.resolve(__dirname, '../../../../examples/react-next');
  const stats = await compiler(entry, {context});
});
