// @ts-check
import LoaderCache from '../src/cache';
import Loader from '../src/loader';

/** @param {Record<string, string>} files */
export function createTestLoader(files) {
  const cache = new LoaderCache();

  /** @type {(thisFilePath: string, symbols?: string[]) => Promise<import('../src/loader').LoadResult>} */
  return async function testLoader(thisFilePath, symbols = undefined) {
    if (files[thisFilePath] == null) {
      throw `Attempted to load undeclared file ${thisFilePath}`;
    }

    /** @type {import('../src/loader').Host} */
    const adapter = {
      async getSource(filePath) {
        return files[filePath];
      },
      async resolve(filePath) {
        return filePath;
      },
      cache,
    };

    const loader = new Loader(adapter);
    return await loader.load(thisFilePath, symbols);
  };
}
