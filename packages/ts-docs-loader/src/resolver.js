// @ts-check

const path = require('node:path');
const fs = require('node:fs');

const ts = require('typescript');

/**
 * Create a TypeScript module resolver based on the given context path.
 *
 * @param {string} sourcePath
 * @return {(moduleName: string) => (string | undefined)}
 */
module.exports = function getTSResolver(sourcePath) {
  const context = path.dirname(sourcePath);
  const tsConfigPath = ts.findConfigFile(context, ts.sys.fileExists);

  let compilerOptions;
  if (tsConfigPath != null) {
    const configContent = ts.readConfigFile(tsConfigPath, ts.sys.readFile).config;
    const tsConfigObject = ts.parseJsonConfigFileContent(configContent, ts.sys, context);
    compilerOptions = tsConfigObject.options;
  } else {
    compilerOptions = ts.getDefaultCompilerOptions();
  }

  return (moduleName) => {
    const resolved = ts.resolveModuleName(moduleName, sourcePath, compilerOptions, ts.sys);
    return resolved?.resolvedModule?.resolvedFileName;
  };
};
