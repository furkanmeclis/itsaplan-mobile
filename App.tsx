import { Text } from './src/components/Text';
import { useState } from 'react';
import { KeyboardAvoidingView, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Host, Column, Row, Button } from '@expo/ui';
import DemoApp from './DemoApp';
import { LiveApp } from './src/screens/LiveApp';
import { sakinTheme } from './src/theme';

export default function App() {
  const [demo, setDemo] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const Header = width / fontScale < 250 ? Column : Row;
  return <SafeAreaProvider>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: sakinTheme.colors.background }}>
        <Host matchContents style={{ width: '100%' }} seedColor={sakinTheme.colors.primary} colorScheme="light">
          <Header spacing={8} alignment="center" style={{ padding: 12, width: '100%' }}>
            <Text textStyle={{ color: sakinTheme.colors.primary, fontWeight: '700' }}>{demo ? 'Örnek veriler' : 'Sunucu hesapları'}</Text>
            <Button variant="text" label={demo ? 'Gerçek hesaplara dön' : 'Demoyu incele'} onPress={() => setDemo(!demo)} />
          </Header>
        </Host>
        <View style={{ flex: 1 }}>{demo ? <DemoApp /> : <LiveApp />}</View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </SafeAreaProvider>;
}
