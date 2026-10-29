import { View, Platform, useWindowDimensions } from 'react-native';
import { registerRootComponent } from 'expo';
import { Host } from '@expo/ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../src/components/Text';
import { sakinTheme } from '../src/theme';

function FontProbe() {
  const { fontScale } = useWindowDimensions();
  return <View style={{ flex: 1, paddingTop: 100, paddingHorizontal: 24, backgroundColor: sakinTheme.colors.background }}>
    <Host key={fontScale} matchContents onLayoutContent={({ nativeEvent: { width, height } }) => {
      if (width > 0 && height > 0) void AsyncStorage.setItem('itsaplan.font-probe.v1', JSON.stringify({ marker: 'IPM_FONT_PROBE', platform: Platform.OS, fontScale, width, height }));
    }}><Text textStyle={{ fontSize: 24, fontWeight: '700' }}>IPM</Text></Host>
  </View>;
}
registerRootComponent(FontProbe);
