'use client';

import * as React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {InterfaceNode, MethodNode, PropertyNode, Node, ComponentNode, GeneratedDocs} from '@faulty/ts-docs-node-types';
import {Type, TypeContext} from '@faulty/ts-docs-type-renderer/react';

import styles from './PropTable.module.css';
import './renderer.css';

interface PropTableProps {
  properties: Array<PropertyNode | MethodNode>;
}

export function PropTable(props: PropTableProps) {
  const {properties} = props;

  // Default to showing required indicators if some properties are optional but not all.
  const showRequired = !properties.every((p) => p.optional) && !properties.every((p) => !p.optional);
  // Show default values by default if any of the properties have one defined.
  const showDefault = properties.some((p) => !!p.default);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.tableHeader}>Name</th>
          <th className={styles.tableHeader} style={{width: '30%'}}>
            Type
          </th>
          {showDefault && <th className={styles.tableHeader}>Default</th>}
          <th className={styles.tableHeader}>Description</th>
        </tr>
      </thead>
      <tbody>
        {properties.map((prop, index) => (
          <tr key={index}>
            <td className={styles.tableCell}>
              <code>{prop.name}</code>
              {!prop.optional && showRequired ? <span className={styles.requiredDot}>{'*'}</span> : null}
            </td>
            <td className={styles.tableCell}>
              <code>
                <Type type={prop.value} renderOptions={{elideUnionUndefined: true}} />
              </code>
            </td>
            {showDefault && (
              <td className={styles.tableCell}>
                <code>{prop.default ?? '—'}</code>
              </td>
            )}
            <td className={styles.tableCell}>
              {prop.description != null ? <Markdown remarkPlugins={[remarkGfm]}>{prop.description}</Markdown> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ComponentAPIProps {
  docs: GeneratedDocs;
  /**
   * Name of the component to show documentation for. The `props` of the
   * component will be shown as a PropTable.
   *
   * The component must exist as an export in the provided `docs`, and is
   * expected to be a ComponentNode. */
  componentName: string;
}

export function ComponentAPI(props: ComponentAPIProps) {
  const {componentName, docs} = props;
  const component = docs.exports[componentName] as ComponentNode;
  const links = docs.links;

  const {props: propsInterface} = component;

  const properties = Object.values((propsInterface as InterfaceNode).properties).filter(
    (prop: Node) => prop.access !== 'private' && prop.access !== 'protected',
  ) as Array<PropertyNode | MethodNode>;

  // Sort props so required ones are shown first, then alphabetically
  properties.sort((a, b) => {
    const alphabetic = a.name.localeCompare(b.name);
    const required = !a.optional && b.optional ? -1 : a.optional && !b.optional ? 1 : 0;

    return required === 0 ? alphabetic : required;
  });

  return (
    <TypeContext.Provider value={links}>
      <PropTable properties={properties} />
    </TypeContext.Provider>
  );
}
