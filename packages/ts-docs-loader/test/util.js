import assert from 'node:assert/strict';

/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 */

/**
 * @param {Node} node
 * @param {object} expected
 */
export function assertNodeContent(node, expected) {
  for (const key in expected) {
    if (expected[key] instanceof Object) {
      assert.deepEqual(node[key], expected[key], `key '${key}' did not match`);
    } else {
      assert.equal(node[key], expected[key], `key '${key}' did not match`);
    }
  }
}
