import { useEffect, useState } from 'react';
import { BackHandler, Linking } from 'react-native';
import { Host, Column, ScrollView, Button } from '@expo/ui';
import { sakinTheme } from '../theme';
import { Text } from '../components/Text';
import Constants from 'expo-constants';
import { sourceLinks } from '../domain/source';

export function OpenSource({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState(false);
  const source = sourceLinks(Constants.expoConfig?.extra?.sourceRevision);
  const archive = source.archive;
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
      <Text>{source.revision ? `Bu derlemenin kaynak sürümü: ${source.revision.slice(0,7)}` : 'Yerel derlemenin sabit kaynak sürümü kaydedilmedi.'}</Text>
      <Button label={source.revision ? "Bu sürümün kaynak kodu" : "Kaynak deposunu aç"} onPress={() => open(source.repository)} />
      {archive && <Button label="Bu sürümün kaynak arşivi" variant="outlined" onPress={() => open(archive)} />}
      <Button label="AGPL lisans metni" variant="outlined" onPress={() => open(source.license)} />
      <Button label="Lisanslar ve kaynak sağlama" variant="outlined" onPress={() => open(source.information)} />
      <Text>Bu uygulama croffasia/itsaplan açık kaynak projesiyle çalışır. Üçüncü taraf bileşenler kendi lisanslarını korur.</Text>
      <Button label="Upstream It’s a Plan" variant="outlined" onPress={() => open('https://github.com/croffasia/itsaplan')} />
      {error && <Text textStyle={{ color: sakinTheme.colors.danger }}>Bağlantı açılamadı. Daha sonra yeniden deneyebilirsin.</Text>}
    </Column></ScrollView>
  </Host>;
}
