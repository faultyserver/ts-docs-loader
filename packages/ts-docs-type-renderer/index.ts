import {Child, h} from 'hastscript';

import {
  AliasNode,
  ApplicationNode,
  ArrayNode,
  BooleanNode,
  ComponentNode,
  ConditionalNode,
  FunctionNode,
  IdentifierNode,
  IndexedAccessNode,
  InterfaceNode,
  IntersectionNode,
  KeywordNode,
  LinkNode,
  MethodNode,
  NumberNode,
  ObjectNode,
  ParameterNode,
  PropertyNode,
  StringNode,
  SymbolNode,
  TemplateNode,
  TupleNode,
  Node,
  TypeOperatorNode,
  TypeParameterNode,
  UnionNode,
} from '@faulty/ts-docs-node-types';

import type {Element} from 'hast';

/**
 * Even shorter-hand for rendering a span node with the given specifier.
 */
function n(specifier: string, children: Child) {
  return h(`span.${specifier}`, {}, children);
}

function p(content: string) {
  return n('punctuation', content);
}
function id(content: string) {
  return n('identifier', content);
}
function k(content: string) {
  return n('keyword', content);
}

const OPAQUE_ALIAS_TYPES = ['keyof', 'typeOperator', 'template'];

interface RenderScope {
  /**
   * Unions with a large number of type are hard to read in a single line. This
   * property controls whether the renderer can wrap each element type onto its
   * own line to help readability.
   *
   * When true, unions with more than 5 string literal elements _or_ more than
   * 3 elements of any non-string kind will be wrapped.
   */
  wrapLargeUnions: boolean;
  /**
   * When rendering object properties, the property itself can be declared as
   * optional with the `?` modifier, which means the property can be omitted
   * from the object declaration and the value of that property will be
   * `undefined`. But type annotations can also explicitly include `| undefined`,
   * meaning the property _must_ be provided, but can be set to `undefined`.
   * These are not exactly the same, but the result is that `?` _supercedes_
   * `| undefined`, making it redundant to specify both.
   *
   * This property controls whether the renderer can omit the unnecessary
   * `| undefined` from a type union, for example when rendering an object
   * property.
   */
  elideUnionUndefined: boolean;
  /**
   * Function signatures within a Union of types are syntactically ambiguous:
   * `() => number | undefined` could either be an optional function that
   * returns a number, or a function that optionally returns a number. To
   * remove the ambiguity, TypeScript requires that function signatures within
   * a union type are surrounded by parentheses, meaning the above example is
   * invalid, and would have to be written as `(() => number) | undefined` or
   * `(() => number | undefined)`.
   *
   * This property controls whether the renderer must wrap function signatures
   * in parenthese to satisfy this requirement.
   */
  requireFunctionParens: boolean;
}

export type PartialRenderScope = Partial<RenderScope>;

const ROOT_SCOPE: RenderScope = {
  wrapLargeUnions: true,
  elideUnionUndefined: false,
  requireFunctionParens: false,
};

export class TypeRenderer {
  scopes: PartialRenderScope[];
  types: Record<string, Node>;

  constructor(types: Record<string, Node>, initialScope: PartialRenderScope = {}) {
    this.types = types;
    this.scopes = [initialScope];
  }

  getOption<T extends keyof RenderScope>(property: T): RenderScope[T] {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (property in this.scopes[i]) {
        return this.scopes[i][property]!;
      }
    }

    return ROOT_SCOPE[property];
  }

  pushScope(scope: PartialRenderScope) {
    this.scopes.push(scope);
  }

  popScope() {
    this.scopes.pop();
  }

  render(type: Node): Element {
    switch (type.type) {
      case 'any':
      case 'null':
      case 'undefined':
      case 'void':
      case 'unknown':
      case 'never':
      case 'this':
        return this.renderKeyword(type);
      case 'symbol':
        return this.renderSymbol(type);
      case 'identifier':
        return this.renderIdentifier(type);
      case 'string':
        if (type.value) return this.renderStringLiteral(type);
        return this.renderKeyword(type);
      case 'number':
        if (type.value) return this.renderNumberLiteral(type);
        return this.renderKeyword(type);
      case 'boolean':
        if (type.value) return this.renderBooleanLiteral(type);
        return this.renderKeyword(type);
      case 'union':
        return this.renderUnion(type);
      case 'intersection':
        return this.renderIntersection(type);
      case 'application':
        return this.renderTypeApplication(type);
      case 'function':
        return this.renderFunction(type);
      case 'parameter':
        return this.renderParameter(type);
      case 'link':
        return this.renderLink(type);
      case 'interface':
        return this.renderInterface(type);
      case 'object':
        if (type.properties) return this.renderObject(type);
        return this.renderKeyword(type);
      case 'alias':
        return this.renderAlias(type);
      case 'array':
        return this.renderArray(type);
      case 'tuple':
        return this.renderTuple(type);
      case 'typeParameter':
        return this.renderTypeParameter(type);
      case 'component':
        return this.renderComponent(type);
      case 'conditional':
        return this.renderConditional(type);
      case 'indexedAccess':
        return this.renderIndexedAccess(type);
      case 'typeOperator':
        return this.renderTypeOperator(type);
      case 'keyof':
        return this.renderTypeOperator({type: 'typeOperator', operator: 'keyof', value: type.keyof});
      case 'template':
        return this.renderTemplateLiteral(type);
      default:
        console.warn('no render component for TYPE', type);
        return n('unknown', []);
    }
  }

  renderKeyword = (type: KeywordNode) => k(type.type);
  renderSymbol = (type: SymbolNode) => n('symbol', type.type);
  renderIdentifier = (type: IdentifierNode) => id(type.name);
  renderBooleanLiteral = (type: BooleanNode) => n('booleanLiteral', type.value!);
  renderNumberLiteral = (type: NumberNode) => n('numberLiteral', type.value!);
  renderStringLiteral = (type: StringNode) => n('stringLiteral', `'${type.value!}'`);

  renderTypeList(types: Node[], joiner: Element): Element[] {
    const elements: Element[] = [];
    for (const type of types) {
      if (elements.length > 0) elements.push(joiner);
      elements.push(this.render(type));
    }
    return elements;
  }

  renderUnion(type: UnionNode) {
    let elements = type.elements;
    if (this.getOption('elideUnionUndefined')) {
      elements = type.elements.filter((element) => element.type !== 'undefined');
    }

    const isSimpleStringUnion = elements.every((element) => element.type === 'string');
    const shouldWrap =
      this.getOption('wrapLargeUnions') && isSimpleStringUnion ? elements.length > 5 : elements.length > 3;

    // By default, any union would require function parens, but if we're eliding
    // the undefined parameter, the resulting type might just be a single type,
    // meaning the parens are unnecessary.
    const requireFunctionParens = elements.length > 1;

    this.pushScope({elideUnionUndefined: false, requireFunctionParens, wrapLargeUnions: false});
    const rendered = n(
      'union',
      this.renderTypeList(elements, n('punctuation', [shouldWrap ? h('br') : null, ' |\u00A0'])),
    );
    this.popScope();

    return rendered;
  }

  renderIntersection(type: IntersectionNode) {
    return n('intersection', this.renderTypeList(type.types, p(' &\u00A0')));
  }

  renderTypeParameter(type: TypeParameterNode) {
    const constraint = type.constraint != null ? [k(' extends '), this.render(type.constraint)] : [];
    const defaultType = type.default != null ? [k(' extends '), this.render(type.default)] : [];

    return n('typeParameter', [id(type.name), ...constraint, ...defaultType]);
  }

  renderTypeParameters(parameters: TypeParameterNode[]): Element[] {
    if (parameters.length === 0) return [];
    return [p('<'), ...this.renderTypeList(parameters, p(', ')), p('>')];
  }

  renderTypeApplication(type: ApplicationNode) {
    return n('application', [this.render(type.base), ...this.renderTypeParameters(type.typeParameters)]);
  }

  renderParameter(type: ParameterNode) {
    const value = type.value != null ? [p(':\u00A0'), this.render(type.value)] : [];
    return n('parameter', [type.rest ? p('...') : null, id(type.name), type.optional ? p('?') : null, ...value]);
  }

  renderFunction(type: FunctionNode) {
    const {name, parameters, return: returnType, typeParameters} = type;
    const requiresParens = this.getOption('requireFunctionParens');

    const anonymous = name == null;

    return n('function', [
      requiresParens ? p('(') : null,
      !anonymous ? id(name) : null,
      ...this.renderTypeParameters(typeParameters),
      p('('),
      ...this.renderTypeList(parameters, p(', ')),
      p(')'),
      p(anonymous ? ' => ' : ': '),
      this.render(returnType),
      requiresParens ? p(')') : null,
    ]);
  }

  renderAlias(type: AliasNode) {
    const {name, value} = type;
    if (
      // These types are more complex than it's worth showing. We can resolve
      // them to a full set of values, but the alias name is generally more
      // useful to see.
      OPAQUE_ALIAS_TYPES.includes(value.type) ||
      // Or if the value is a union of types, then any of them being one of these
      // complex types constitutes using an alias as well.
      (value.type === 'union' && value.elements.some((element) => OPAQUE_ALIAS_TYPES.includes(element.type)))
    ) {
      return n('alias', name);
    }

    return this.render(value);
  }

  renderArray(type: ArrayNode) {
    return n('array', [this.render(type.elementType), p('[]')]);
  }

  renderTuple(type: TupleNode) {
    return n('tuple', [p('['), ...this.renderTypeList(type.elements, p(', ')), p(']')]);
  }

  renderTypeOperator(type: TypeOperatorNode) {
    return n('typeOperator', [k(`${type.operator} `), this.render(type.value)]);
  }

  renderConditional(type: ConditionalNode) {
    return n('conditionalType', [
      this.render(type.checkType),
      k(' extends '),
      this.render(type.extendsType),
      p(' ? '),
      this.render(type.trueType),
      p(' : '),
      this.render(type.falseType),
    ]);
  }

  renderIndexedAccess(type: IndexedAccessNode) {
    return n('indexedAccess', [this.render(type.objectType), p('['), this.render(type.indexType), p(']')]);
  }

  renderTemplateLiteral(type: TemplateNode) {
    const elements = type.elements.flatMap((element) => {
      if (element.type === 'string' && element.value != null) {
        return [n('stringLiteral', element.value)];
      } else {
        return [p('${'), this.render(element), p('}')];
      }
    });
    return n('templateLiteral', [n('stringLiteral', ['`', ...elements, '`'])]);
  }

  renderPropertyOrMethod(type: PropertyNode | MethodNode): Element[] {
    // If the name can't be expressed as plain identifier, quote it.
    // Things like `aria-label` or `data-name`.
    // See https://mathiasbynens.be/notes/javascript-identifiers-es6
    const isComplexIdent = !/^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]+$/u.test(type.name);
    const isIndexSignature = 'indexType' in type && type.indexType != null;

    const ident = isComplexIdent ? n('stringLiteral', `'${type.name}'`) : n('identifier', type.name);
    const propName = isIndexSignature ? [p('['), ident, p(':'), this.render(type.indexType!), p(']')] : [ident];

    return [...propName, p(type.optional ? '?: ' : ': '), this.render(type.value)];
  }

  renderObject(type: ObjectNode) {
    const properties = Object.values(type.properties).map((prop, i, arr) =>
      n('property', [...this.renderPropertyOrMethod(prop), i < arr.length - 1 ? p(', ') : null]),
    );
    return n('object', [p('{'), ...properties, p('}')]);
  }

  renderInterface(type: InterfaceNode) {
    // In an inline context, just render the name of the interface for brevity.
    // Eventually it can link to a full representation of the interface.
    if (!!true) {
      return this.renderIdentifier({...type, type: 'identifier'});
    }

    // Only show public properties of the interface
    const properties = Object.fromEntries(
      Object.entries(type.properties).filter(
        ([, prop]: [string, Node]) => prop.access !== 'private' && prop.access !== 'protected',
      ),
    ) as Record<string, PropertyNode | MethodNode>;

    return this.renderObject({...type, properties, type: 'object'});
  }

  renderComponent(type: ComponentNode) {
    let props = type.props;
    if (props == null) return n('component', []);

    if (props?.type === 'application') {
      props = props.base;
    }
    if (props?.type === 'link') {
      props = this.types[props.id];
    }

    return this.render({...props, description: type.description});
  }

  renderLink(type: LinkNode): Element {
    const resolved = this.types[type.id];
    return n('link', resolved != null ? resolved.name : 'unknown');
  }
}
