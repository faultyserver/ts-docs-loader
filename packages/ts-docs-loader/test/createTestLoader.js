// @ts-check

import path from 'node:path';

import Loader from '../src/loader';

/** @param {Record<string, string>} files */
export function createTestLoader(files) {
  /**
   * Map containing all files that are currently being processed by the loader,
   * as a naive way of dealing with circular dependencies.
   */
  const IN_PROGRESS_SET = new Set();

  /** @type {(thisFilePath: string) => Promise<import('../src/loader').LoadResult>} */
  return async function testLoader(thisFilePath) {
    IN_PROGRESS_SET.add(thisFilePath);
    const context = path.dirname(thisFilePath);

    /** @type {import('../src/loader').Bundler} */
    const adapter = {
      async getSource() {
        return files[thisFilePath];
      },
      getFilePath() {
        return thisFilePath;
      },
      getContext() {
        return context;
      },
      isCurrentlyProcessing(resource) {
        return IN_PROGRESS_SET.has(resource);
      },
      async resolve(filePath) {
        return filePath;
      },
      async importModule(resource) {
        return testLoader(resource);
      },
    };

    const loader = new Loader(adapter);
    const result = await loader.load(thisFilePath).catch((e) => {
      throw e;
    });

    IN_PROGRESS_SET.delete(thisFilePath);
    return result;
  };
}
