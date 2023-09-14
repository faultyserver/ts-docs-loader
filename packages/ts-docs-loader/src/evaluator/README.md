# Evaluator

`ts-docs-loader` is really a partial-evaluator for TypeScript. It doesn't aim to do almost any of what typescript does, there's no checking or enforcement, and a lot of the particularly advanced features like inference and such likely won't ever be implemented, since they require tracking instantiations and other properties that are outside of the scope of documenting the declared types for a codebase.

That said, there are a lot of utilities that TypeScript provides to manipulate and compose types, which _do_ affect the declared types for code, and should be documented accurately. Things like union types, using `extends` on an interface, creating unions of unions, `Omit`/`Pick`/`Exclude`, `Capitalize`/`Lowercase`/etc, and more. All of these need to be implemented to accurately determine the properties and fields of declared types. As an example of a few things:

```typescript
type StyleProps = 'className' | 'style';
type DisallowedProps = StyleProps | 'onChange';

interface BaseProps {
  bar: string;
  className?: string;
  style?: Record<string, any>;
  onChange?(): void;
}

interface Props extends Omit<BaseProps, DisallowedFields> {}
// Without evaluating `extends`, `Omit`, or unions of unions, `Props` would
// either end up having: no properties, all the properties of BaseProps, or
// all of the properties other than `onChange`.
//
// By partially evaluating all of these operations, we get the correct result
// of Props only having `bar` as a Prop, inherited from BaseProps.
```

This folder contains the implementations for these various operations and utilities.
