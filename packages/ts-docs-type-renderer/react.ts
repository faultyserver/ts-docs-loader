import * as React from 'react';

import {PartialRenderScope, TypeRenderer} from './index';
import {toH} from 'hast-to-hyperscript';

import type {Node} from '@faulty/ts-docs-node-types';

export const TypeContext = React.createContext<Record<string, Node>>({});

interface TypeProps {
  type: Node;
  renderOptions?: PartialRenderScope;
}

export function Type(props: TypeProps) {
  const {type, renderOptions} = props;
  const links = React.useContext(TypeContext);

  return React.useMemo(() => {
    const renderer = new TypeRenderer(links, renderOptions);
    return toH(React.createElement, renderer.render(type));
  }, [links, renderOptions, type]);
}
