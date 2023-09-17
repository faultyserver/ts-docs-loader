// @ts-check

import {test} from '@jest/globals';
import assert from 'node:assert/strict';

import LoaderCache from '../src/cache';
import util from '../src/util';

import {builder as b} from './nodeBuilder';

test('Symbols are stored in the cache', () => {
  const cache = new LoaderCache();

  const foo = {node: b.num(), links: []};
  const bar = {node: b.str(), links: []};

  const fooId = util.makeId('index', 'foo');
  const barId = util.makeId('index', 'bar');

  cache.setSymbol(fooId, foo);
  cache.setSymbol(barId, bar);
  const cachedFoo = cache.getCachedSymbol(fooId);
  const cachedBar = cache.getCachedSymbol(barId);

  assert(Object.is(cachedFoo, foo));
  assert(Object.is(cachedBar, bar));
});
