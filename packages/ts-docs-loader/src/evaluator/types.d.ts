import {Node} from '@faulty/ts-docs-node-types';

interface Recurser {
  (node: Node, key?: string): Node;
  (node: Node[], key?: string): Node[];
}

export declare function walk<T extends Node | Record<string, Node>>(
  base: T,
  walkerFn: (node: Node, key: string | null, recurse: Recurser) => Node,
): T;
