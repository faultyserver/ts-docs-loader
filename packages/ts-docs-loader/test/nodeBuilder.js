/**
 * @typedef {import('@faulty/ts-docs-node-types').Node} Node
 * @typedef {import('@faulty/ts-docs-node-types').StringNode} StringNode
 * @typedef {import('@faulty/ts-docs-node-types').NumberNode} NumberNode
 * @typedef {import('@faulty/ts-docs-node-types').BooleanNode} BooleanNode
 * @typedef {import('@faulty/ts-docs-node-types').UnionNode} UnionNode
 * @typedef {import('@faulty/ts-docs-node-types').TypeParameterNode} TypeParameterNode
 * @typedef {import('@faulty/ts-docs-node-types').PropertyNode} PropertyNode
 * @typedef {import('@faulty/ts-docs-node-types').MethodNode} MethodNode
 * @typedef {import('@faulty/ts-docs-node-types').AliasNode} AliasNode
 * @typedef {import('@faulty/ts-docs-node-types').InterfaceNode} InterfaceNode
 */

export const builder = {
  /** @type {(value?: string) => StringNode} */
  str: (value) => (value == null ? {type: 'string'} : {type: 'string', value}),
  /** @type {(value?: string) => NumberNode} */
  num: (value) => (value == null ? {type: 'number'} : {type: 'number', value}),
  /** @type {(value?: string) => BooleanNode} */
  bool: (value) => (value == null ? {type: 'boolean'} : {type: 'boolean', value}),
  /** @type {(elements: Node) => UnionNode} */
  union: (elements) => ({type: 'union', elements}),
  /** @type {(name: string, value: Node, typeParameters: TypeParameterNode[]) => AliasNode} */
  alias: (name, value, typeParameters = []) => ({
    type: 'alias',
    id: name,
    name,
    value,
    typeParameters,
  }),
  /** @type {(name: string, properties: Record<string, PropertyNode | MethodNode>, extensions: Node[], typeParameters: TypeParameterNode[]) => InterfaceNode} */
  interface: (name, properties, extensions = [], typeParameters = []) => ({
    type: 'interface',
    id: name,
    name,
    extends: extensions,
    properties,
    typeParameters,
  }),
};
