import {NodePath} from '@babel/traverse';

export type NodeId = {file: string; symbol: string};

/**
 * EXPORTS
 */

export interface SymbolExport {
  type: 'symbol';
  /** Babel node path to the export */
  path: NodePath;
  /** Name as exported from this module */
  name: string;
  /** Name of the symbol inside of the file (e.g., `Foo as Bar` would be Foo) */
  sourceName: string;
  /** Universally-unique identifier for the symbol. */
  id: NodeId;
}

export interface NamespaceExport {
  type: 'namespace';
  /** Babel node path to the export */
  path: NodePath;
  /** The namespace the imported objects are being exported under (e.g. `* as React` would be React) */
  name: string;
  /** Specifier name of the module the export is being loaded from. */
  sourceFile: string;
  /** Universally-unique identifier for the symbol. */
  id: NodeId;
}

export interface ExternalExport {
  type: 'external';
  /** Babel node path to the export */
  path: NodePath;
  /** Name as exported from this module */
  name: string;
  /** Name of the export from the source module */
  sourceName: string;
  /** Specifier name of the module the export is being proxied from */
  sourceFile: string;
}

export interface WildcardExport {
  type: 'wildcard';
  /** Specifier name of the module the export is being loaded from. */
  sourceFile: string;
}

export type Export = SymbolExport | NamespaceExport | ExternalExport | WildcardExport;
export type NamedExport = Exclude<Export, WildcardExport>;
export type SourceExport = SymbolExport | NamespaceExport;

/**
 * IMPORTS
 */
export interface SymbolImport {
  type: 'symbol';
  /** Name of the symbol in the _importing_ file. */
  localName: string;
  /** Name of the symbol from the in the _imported_ file. */
  sourceName: string;
  /** Specifier name of the module the import is being loaded from. */
  sourceFile: string;
}

// NOTE: Defaults aren't actually handled properly yet since default exports aren't handled.
export interface DefaultImport {
  type: 'default';
  /** Name of the symbol in the _importing_ file. */
  localName: string;
  /** Specifier name of the module the import is being loaded from. */
  sourceFile: string;
}

export interface NamespaceImport {
  type: 'namespace';
  /** Name of the symbol in the _importing_ file. */
  localName: string;
  /** Specifier name of the module the import is being loaded from. */
  sourceFile: string;
}

export type Import = SymbolImport | DefaultImport | NamespaceImport;
