import {Node} from '@faulty/ts-docs-node-types';

export declare function walk<T extends Node | Record<string, Node>>(
  base: T,
  walkerFn: (node: Node, key: string | null, recurse: <N extends Node | Node[]>(n: N, key?: string) => N) => Node,
): T;
