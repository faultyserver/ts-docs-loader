/* eslint-disable no-console */
// @ts-check

const ts = require('typescript');

/**
 * Create a TypeScript module resolver based on the given context path.
 *
 * @param {string} context
 */
module.exports = function getTSResolver(context) {
  const compilerOptions = ts.getDefaultCompilerOptions();

  return (moduleName) =>
    ts.resolveModuleName(moduleName, context, compilerOptions, {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
    });
};
