import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Host, Row, Text, Button } from '@expo/ui';
import DemoApp from './DemoApp';
import { LiveApp } from './src/screens/LiveApp';
import { sakinTheme } from './src/theme';

export default function App() {
  const [demo, setDemo] = useState(false);
  return <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: sakinTheme.colors.background }}>
      <Host matchContents style={{ width: '100%' }} seedColor={sakinTheme.colors.primary} colorScheme="light">
        <Row spacing={16} alignment="center" style={{ padding: 12 }}>
          <Text textStyle={{ color: sakinTheme.colors.primary, fontWeight: '700' }}>{demo ? 'Örnek veriler' : 'Sunucu hesapları'}</Text>
          <Button variant="text" label={demo ? 'Gerçek hesaplara dön' : 'Demoyu incele'} onPress={() => setDemo(!demo)} />
        </Row>
      </Host>
      <View style={{ flex: 1 }}>{demo ? <DemoApp /> : <LiveApp />}</View>
    </SafeAreaView>
  </SafeAreaProvider>;
}
