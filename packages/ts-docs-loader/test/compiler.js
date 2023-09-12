// @ts-check

import * as fs from 'fs';
import {Union} from 'unionfs';
import {memfs} from 'memfs';
import {createFsFromVolume, Volume} from 'memfs';
import path from 'path';
import webpack from 'webpack';

/**
 * @return {Promise<webpack.Stats | undefined>}
 */
export default function compiler(inputFS, options = {}) {
  const entrypoint = options.entrypoint ?? '/index';

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
            loader: path.resolve(__dirname, '../index.js'),
            options,
          },
        },
      ],
    },
  });

  // compiler.inputFileSystem = inputFS;
  // compiler.outputFileSystem = createFsFromVolume(new Volume());
  // compiler.outputFileSystem.join = path.join.bind(path);

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) reject(err);
      if (stats?.hasErrors()) reject(stats.toJson().errors);

      resolve(stats);
    });
  });
}

/**
 * Create a filesystem to provide to mock out node's FS during tests.
 *
 * The returned volume can be used to create and inspect files in memory within
 * a test without having to use the native file system.
 */
export function createFS() {
  const fake = memfs();
  // @ts-ignore types don't exactly match, but are close enough
  return {fs: new Union().use(fake.fs).use(fs), volume: fake.vol};
}
