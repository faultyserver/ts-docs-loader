# ts-docs-type-renderer

Render a ts-docs node tree into a type signature using `hast`.

The resulting hast tree can be rendered by any hyperscript-compatible framework (i.e., JSX-like, like React, Vue, or others).

The rendered tree is annotated with class names for each token so that they can be highlighted accordingly, and links include a `data-link` attribute to be able to render popovers with more information about them.

# Usage

Directly render a type to a hast tree by using `TypeRenderer` and supplying the doc node:

```typescript
import {TypeRenderer} from '@faulty/ts-docs-type-renderer';

const renderer = new TypeRenderer(links, renderOptions);
const result = renderer.render(typeNode);
```

Then convert the hast tree into the appropriate structure for the framework, e.g. for React:

```typescript
import * as React from 'react';
import {toH} from 'hast-to-hyperscript';

return toH(React.createElement, result);
```

For React, there's a convenience component to take care of this automatically:

```typescript
import {Type, TypeContext} from '@faulty/ts-docs-type-renderer/react';

<TypeContext.Provider links={links}>
  <Type type={typeNode} />
</TypeContext.Provider>
```
