// @ts-check

import * as fs from 'node:fs';
import path from 'node:path';
import {createFsFromVolume, Volume} from 'memfs';
import webpack from 'webpack';

const LOADER_PATH = path.resolve(__dirname, '../../index.js');
const FIXTURES_DIR = path.resolve(__dirname, 'generated-fixtures');

/**
 * @return {Promise<webpack.Stats | undefined>}
 */
export default function compiler(entrypoint, options = {}) {
  const compiler = webpack({
    context: __dirname,
    entry: entrypoint,
    output: {
      path: path.resolve(__dirname),
      filename: 'bundle.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /.*$/,
          use: {
            loader: LOADER_PATH,
            options,
          },
        },
      ],
    },
  });

  compiler.outputFileSystem = createFsFromVolume(new Volume());
  compiler.outputFileSystem.join = path.join.bind(path);

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) reject(err);
      if (stats?.hasErrors()) reject(stats.toJson().errors);

      resolve(stats);
    });
  });
}

/**
 * Create a tree of files based on the input configuration, returning a
 * matching record of local names to the full paths that were created.
 *
 * @param {Record<string, string>} files
 * @returns {Record<string, string>}
 */
export function createFixtures(files) {
  fs.rmdirSync(FIXTURES_DIR, {recursive: true});
  fs.mkdirSync(FIXTURES_DIR, {recursive: true});

  /** @type {Record<string, string>} */
  const created = {};

  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(FIXTURES_DIR, name);
    fs.writeFileSync(fullPath, content);
    created[name] = fullPath;
  }

  return created;
}
