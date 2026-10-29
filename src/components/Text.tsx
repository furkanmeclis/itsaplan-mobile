import { Platform, useWindowDimensions } from 'react-native';
import { Text as UniversalText, type TextProps } from '@expo/ui';
import { accessibleTextStyle } from '../themeText';

/** One universal component; retain Android sp and SwiftUI custom-font scaling. */
export function Text(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  return <UniversalText {...props} textStyle={accessibleTextStyle(props.textStyle, Platform.OS, fontScale)} />;
}
