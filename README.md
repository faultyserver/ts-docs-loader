# ts-docs-loader

Generate and import documentation for typescript components, interfaces, functions, aliases, and more, all on-the-fly and efficiently through a webpack loader.

## Usage

Install the loader as a dependency (likely a devDependency, since this isn't needed at runtime):

```shell
pnpm add -D @faulty/ts-docs-loader
```

Add an entry to `resolveLoader` in your webpack config:

```javascript
{
    ...,
    resolveLoader: {
        'doc': '@faulty/ts-docs-loader',
    }
}
```

Then just import the file you want documentation for using the direct loader syntax:

```typescript
import docs from '!doc!path/to/your/file';

// `.exports` is a map of entity names to their type documentation
docs.exports["Props"]
// `.links` is a map of types that are referenced by other types in the exports
docs.links
```

## Development

This repo uses `pnpm` as the package manager.

More steps will be added later.

## Credit

This library is directly inspired by the documentation transformer and packager created by [React Spectrum from Adobe](https://github.com/adobe/react-spectrum/blob/639548c489d5d4ef3225f62c9a64a474648d183d/packages/dev/parcel-transformer-docs/DocsTransformer.js), initially adapted to work with Webpack instead of Parcel.

Since the initial re-implementation, various features have been added to accommodate more type syntax, resolve types through libraries using TypeScript itself, and implement more type evaluation to give more complete results.