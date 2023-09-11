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

  compiler.inputFileSystem = inputFS;
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
 * Create a filesystem to provide to the compiler for a test. Each file in
 * `files` will be created.
 *
 * By default, an `index` file will be used by the compiler as the entrypoint.
 * When using multiple files, this can be changed by passing an `entrypoint`
 * name as an option.
 *
 * @param {Record<string, string>} files Map of file names to their content
 */
export function createFiles(files) {
  // @ts-ignore types don't exactly match, but are close enough
  return new Union().use(memfs(files).fs).use(fs);
}
