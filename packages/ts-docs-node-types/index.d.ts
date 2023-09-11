interface Asset {
  // Unique name for the asset, realistically just the absolute path to it.
  id: string;
  exports: Record<string, Node>;
  links: Record<string, Node>;
  // Map of all symbols exported from the asset. The key is the public name of
  // the export, and the value is the name locally within the asset.
  // e.g. export {foo as Bar} results in a key of 'Bar' pointing to 'foo';
  symbols: Map<string, string>;
}

interface NodeDocs {
  description?: string | null;
  selector?: string | null;
  access?: string | null;
  default?: string | null;
  return?: string | null;
  // TODO: Only documented for function nodes?
  params?: Record<string, string>;
}

interface NodeBase extends NodeDocs {
  id?: string;
  name?: string;
}

interface AnyNode extends NodeBase {
  type: 'any';
}

interface ThisNode extends NodeBase {
  type: 'this';
}
interface SymbolNode extends NodeBase {
  type: 'symbol';
}
interface BooleanNode extends NodeBase {
  type: 'boolean';
  value?: string;
}
interface StringNode extends NodeBase {
  type: 'string';
  value?: string;
}
interface NumberNode extends NodeBase {
  type: 'number';
  value?: string;
}
interface NullNode extends NodeBase {
  type: 'null';
}
interface UndefinedNode extends NodeBase {
  type: 'undefined';
}
interface VoidNode extends NodeBase {
  type: 'void';
}
interface UnknownNode extends NodeBase {
  type: 'unknown';
}
interface NeverNode extends NodeBase {
  type: 'never';
}

interface ArrayNode extends NodeBase {
  type: 'array';
  elementType: Node;
}

interface ObjectNode extends NodeBase {
  type: 'object';
  properties: Record<string, PropertyNode | MethodNode>;
}

interface UnionNode extends NodeBase {
  type: 'union';
  elements: Node[];
}

interface IntersectionNode extends NodeBase {
  type: 'intersection';
  types: Node[];
}

interface TupleNode extends NodeBase {
  type: 'tuple';
  elements: Node[];
}

interface TemplateNode extends NodeBase {
  type: 'template';
  elements: Node[];
}

interface TypeParameterNode extends NodeBase {
  type: 'typeParameter';
  name: string;
  constraint: Node | null;
  default: Node | null;
}

interface ParameterNode extends NodeBase {
  type: 'parameter';
  name: string;
  value: Node;
  optional: boolean;
  rest: boolean;
}

interface EnumNode extends NodeBase {
  type: 'enum';
  name: string;
  members: EnumMemberNode[];
}

interface EnumMemberNode extends NodeBase {
  type: 'enumMmeber';
  name: string;
  value?: Node;
}

interface InterfaceNode extends NodeBase {
  type: 'interface';
  id: string;
  name: string;
  extends: Node[];
  properties: Record<string, PropertyNode | MethodNode>;
  typeParameters: TypeParameterNode[];
}

interface InheritableNode {
  /** id of the interface that this property was inherited from */
  inheritedFrom?: string;
}

interface PropertyNode extends NodeBase, InheritableNode {
  type: 'property';
  name: string;
  value: Node;
  optional?: boolean;
  indexType?: Node;
}

interface MethodNode extends NodeBase, InheritableNode {
  type: 'method';
  name: string;
  value: FunctionNode;
  optional?: boolean;
}

interface FunctionNode extends NodeBase {
  type: 'function';
  id?: string;
  name?: string;
  parameters: ParameterNode[];
  return: Node;
  typeParameters: TypeParameterNode[];
}

interface ComponentNode extends NodeBase {
  type: 'component';
  id: string;
  name: string;
  props: Node | null;
  typeParameters: TypeParameterNode[];
  ref: Node | null;
}

interface ApplicationNode extends NodeBase {
  type: 'application';
  base: Node;
  typeParameters: TypeParameterNode[];
}

interface IdentifierNode extends NodeBase {
  type: 'identifier';
  name: string;
}

interface ReferenceNode extends NodeBase {
  type: 'reference';
  local: string;
  imported: string;
  // The source file from which this reference comes
  specifier: string;
}

interface AliasNode extends NodeBase {
  type: 'alias';
  id: string;
  name: string;
  value: Node;
  typeParameters: TypeParameterNode[];
}

interface TypeOperatorNode extends NodeBase {
  type: 'typeOperator';
  operator: string;
  value: Node;
}

/** I don't think this actually gets hit */
interface KeyofNode extends NodeBase {
  type: 'keyof';
  keyof: Node;
}

interface ConditionalNode extends NodeBase {
  type: 'conditional';
  checkType: Node;
  extendsType: Node;
  trueType: Node;
  falseType: Node;
}

interface IndexedAccessNode extends NodeBase {
  type: 'indexedAccess';
  objectType: Node;
  indexType: Node;
}

interface LinkNode extends NodeBase {
  type: 'link';
  id: string;
}

/**
 * Nodes that can represent keywords in the source. Some nodes may also
 * represent literals instead.
 */
export type KeywordNode =
  | AnyNode
  | BooleanNode
  | NeverNode
  | NullNode
  | NumberNode
  | ObjectNode
  | StringNode
  | SymbolNode
  | ThisNode
  | UndefinedNode
  | UnknownNode
  | VoidNode;

export type Node =
  | AliasNode
  | AnyNode
  | ApplicationNode
  | ArrayNode
  | BooleanNode
  | ComponentNode
  | ConditionalNode
  | FunctionNode
  | IdentifierNode
  | IndexedAccessNode
  | InterfaceNode
  | IntersectionNode
  | KeyofNode
  | MethodNode
  | NeverNode
  | NullNode
  | NumberNode
  | ObjectNode
  | ParameterNode
  | PropertyNode
  | ReferenceNode
  | StringNode
  | SymbolNode
  | TemplateNode
  | ThisNode
  | TupleNode
  | TypeOperatorNode
  | TypeParameterNode
  | UndefinedNode
  | UnionNode
  | UnknownNode
  | VoidNode
  // These nodes aren't from the source, they're created by Bundler
  | LinkNode;
