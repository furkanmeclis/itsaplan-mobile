import { useEffect, useState } from 'react';
import { BackHandler, Linking } from 'react-native';
import { Host, Column, ScrollView, Button } from '@expo/ui';
import { sakinTheme } from '../theme';
import { Text } from '../components/Text';

const repository = 'https://github.com/furkanmeclis/itsaplan-mobile';
export function OpenSource({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => listener.remove();
  }, [onBack]);
  const open = (url: string) => { setError(false); void Linking.openURL(url).catch(() => setError(true)); };
  return <Host colorScheme="light" seedColor={sakinTheme.colors.primary} style={{ flex: 1, backgroundColor: sakinTheme.colors.background }}>
    <ScrollView style={{ width: '100%', height: '100%' }}><Column spacing={16} style={{ padding: 24, width: '100%' }}>
      <Button label="Hesaplara dön" variant="text" onPress={onBack} />
      <Text textStyle={{ fontSize: 24, fontWeight: '700', color: sakinTheme.colors.text }}>Açık kaynak</Text>
      <Text>It’s a Plan Mobile · AGPL-3.0-only</Text>
      <Text>Mobil uygulamanın, sunucu entegrasyonunun ve push gateway’in kaynak kodu herkese açıktır.</Text>
      <Button label="Kaynak kodunu aç" onPress={() => open(repository)} />
      <Button label="AGPL lisans metni" variant="outlined" onPress={() => open(`${repository}/blob/main/LICENSE`)} />
      <Button label="Lisanslar ve kaynak sağlama" variant="outlined" onPress={() => open(`${repository}/blob/main/docs/open-source.md`)} />
      <Text>Bu uygulama croffasia/itsaplan açık kaynak projesiyle çalışır. Üçüncü taraf bileşenler kendi lisanslarını korur.</Text>
      <Button label="Upstream It’s a Plan" variant="outlined" onPress={() => open('https://github.com/croffasia/itsaplan')} />
      {error && <Text textStyle={{ color: sakinTheme.colors.danger }}>Bağlantı açılamadı. Daha sonra yeniden deneyebilirsin.</Text>}
    </Column></ScrollView>
  </Host>;
}
