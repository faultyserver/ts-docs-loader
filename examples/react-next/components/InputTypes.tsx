/**
 * React Native Input components have a broad set of properties to control them,
 * some of which we do not want to inherit (onChange) or expose to consumers of
 * the design system (style). Omitting these props from a native component's
 * props will ensure that the resulting interface does not leak any of those
 * unwanted props to consumers.
 *
 * Other inputs may have additional props to omit based on the type of native
 * input component being used, in which case they should use this type as a
 * union with all of the other props to omit.
 */
export type DisallowedNativeInputProps =
  // We want to enforce strict styling on inputs themselves, so consumers are not
  // able to override any styles on inputs.
  | 'style'
  // We are forgoing react-native's default event handlers, which provide the
  // event as the argument for `onChange` and use a secondary callback,
  // `onChangeText`, to provide the text value directly.
  // Instead, for simplicity and convenience, we are making `onChange` act like
  // `onChangeText` and provide the text value rather than the event. This
  // appears to be a safe behavior, as in our entire native codebase, there are
  // only a few handlers that even read the event in the first place, and even
  // those only use it to retrieve the textual value.
  // This also lets non-textual inputs have a consistent API, using
  // `onChange(value: T)` to provide any relevant data type without having to
  // use a different callback name.
  | 'onChange'
  | 'onChangeText'
  // Similarly, we define `value` directly using `InputValueProps` to let it
  // take on different data types
  | 'defaultValue'
  | 'value';

export interface InputValueProps<T> {
  /**
   * Initial value to use for the input. Setting this will allow the input
   * value to change without needing to update it through controlled state.
   */
  defaultValue?: T;
  /** When given, controls the value of the input. If omitted, the input is
   * considered "uncontrolled". It will still function and fire callbacks as
   * expected, but without the need for the consumer to provide the value.
   *
   * Uncontrolled inputs can still provide an initial value to set on the
   * input by using the `defaultValue` prop. */
  value?: T;
  /**
   * Called as soon as the value of the input changes. For textual inputs, this
   * happens on every entry or deletion while the user is editing the value. For
   * picker-based inputs, this happens when the user selects a value.
   * Note that the argument to the callback is the value of the input directly,
   * rather than the change event that was fired.
   */
  onChange?: (value: T) => void;
}

/**
 * Common interface for querying and manipulating the state of an input. Each
 * input type should extend this interface for whatever value type it contains,
 * and provide any additional useful methods for interacting with its value.
 */
export interface InputState {
  /** Whether the input currently has a non-empty value. */
  hasValue: boolean;
  /** Set the textual value of the input and call `onChange` */
  setTextValue: (value: string) => void;
  /** Set the text value of the input to an empty string and call `onClear`. */
  clear: () => void;
}

/** Props related to making an input immediately clearable. */
export interface ClearableProps {
  /** Whether the input can be cleared by the tap of a clear button that appears in the input. */
  isClearable?: boolean;
  /** Called when the user clears the input via the clear button. */
  onClear?: () => void;
}

export interface RoundableProps {
  /** Whether the input should use a fully-rounded border radius. */
  isRound?: boolean;
}

export type InputStatus = 'default' | 'error' | 'focused';
export type InputSize = 'sm' | 'md' | 'lg';

export interface InputStyleProps {
  /** Validation status of the input. Statuses are used to communicate error
   * and warning states to the user through non-textual cues like colors and borders. */
  status?: InputStatus;
  /** Size category to use for the input. Note that not all input types allow
   * different size categories. */
  size?: InputSize;
}
export interface InputAttachmentProps {
  /**
   * Icon to render at the leading edge of the input. Only redesign icons should
   * be used here. When rendering, fallbacks will be omitted.
   */
  leadingIcon?: React.ComponentType;
  /**
   * Icon to render at the trailing edge of the input. Only redesign icons should
   * be used here. When rendering, fallbacks will be omitted.
   *
   * If the input is clearable, the trailing attachment will be replaced by a
   * button to clear the input when it contains a value.
   */
  trailingIcon?: React.ComponentType;
  /**
   * Text to render at the leading edge of the input. Attachment text should
   * generally be kept as short as possible to preserve space for the input itself.
   *
   * To render an icon as the leading element, use `leadingIcon` instead. If both
   * `leadingText` and `leadingIcon` are given, only the icon will be rendered.
   * Using both on a single input is considered invalid.
   *
   * Note that the type here is intentionally restricted to plain strings to avoid
   * rendering complex content as an input attachment. For formatted text or any
   * additional content, prefer displaying it as a `description`, `label`, or
   * elsewhere surrounding the input rather than inside of it.
   */
  leadingText?: string;
  /**
   * Text to render at the trailing edge of the input. Attachment text should
   * generally be kept as short as possible to preserve space for the input itself.
   *
   * If the input is clearable, the trailing attachment will be replaced by a
   * button to clear the input when it contains a value.
   *
   * To render an icon as the leading element, use `trailingIcon` instead. If both
   * `trailingText` and `trailingIcon` are given, only the icon will be rendered.
   * Using both on a single input is considered invalid.
   *
   * Note that the type here is intentionally restricted to plain strings to avoid
   * rendering complex content as an input attachment. For formatted text or any
   * additional content, prefer displaying it as a `description`, `label`, or
   * elsewhere surrounding the input rather than inside of it.
   */
  trailingText?: string;
}
