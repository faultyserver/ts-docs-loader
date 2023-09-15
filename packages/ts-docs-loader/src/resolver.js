// @ts-check

const path = require('node:path');
const fs = require('node:fs');

const ts = require('typescript');

/**
 * Create a TypeScript module resolver based on the given context path.
 *
 * @param {string} sourcePath
 * @return {(moduleName: string, context: string) => ts.ResolvedModuleWithFailedLookupLocations}
 */
module.exports = function getTSResolver(sourcePath) {
  const context = path.dirname(sourcePath);
  const tsConfigPath = ts.findConfigFile(context, ts.sys.fileExists);

  let compilerOptions;
  if (tsConfigPath != null) {
    const configContent = ts.readConfigFile(tsConfigPath, ts.sys.readFile).config;
    const tsConfigObject = ts.parseJsonConfigFileContent(configContent, ts.sys, path.dirname(tsConfigPath));
    compilerOptions = tsConfigObject.options;
  } else {
    compilerOptions = ts.getDefaultCompilerOptions();
  }

  return (moduleName, containingFile) => {
    const resolved = ts.resolveModuleName(moduleName, containingFile, compilerOptions, ts.sys);
    return resolved;
  };
};
