// @ts-check

import {test} from '@jest/globals';
import assert from 'node:assert/strict';

import getTSResolver from '../../src/resolver';

const THIS_DIR = __dirname;

test('finds and uses the nearest tsconfig for resolving', async () => {
  const resolve = getTSResolver(__filename);
  assert.equal(resolve('./index.tsx', __filename)?.resolvedFileName, `${THIS_DIR}/index.tsx`);
  assert.equal(resolve('@analias', __filename)?.resolvedFileName, `${THIS_DIR}/resolvedalias.tsx`);
});
