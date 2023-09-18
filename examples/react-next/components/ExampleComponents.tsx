import * as React from 'react';
import {TextInputProps} from 'react-native';
import {
  ClearableProps,
  DisallowedNativeInputProps,
  InputAttachmentProps,
  InputStyleProps,
  InputValueProps,
  RoundableProps,
} from './InputTypes';

interface ExampleInputProps
  extends Omit<TextInputProps, DisallowedNativeInputProps>,
    InputValueProps<number>,
    InputStyleProps,
    InputAttachmentProps,
    ClearableProps,
    RoundableProps {}

export function ExampleInput(props: ExampleInputProps) {
  return <div></div>;
}
