import { Text } from './src/components/Text';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Host, Column, Row, Button, ScrollView, Switch, TextInput } from '@expo/ui';
import { sakinTheme, type Theme } from './src/theme';
import { accountKey, resourceKey, type Account } from './src/domain/accounts';
import { createDemoData, demoAccounts, type DemoTask } from './src/demo/data';

type Tab = 'Görevler' | 'Projeler' | 'Bildirimler' | 'Hesaplar';
type Selection = { account: Account; taskId: number };

export default function App() {
  return <MobileApp />;
}

function MobileApp() {
  const [theme, setTheme] = useState(sakinTheme);
  const [tab, setTab] = useState<Tab>('Görevler');
  const [accounts, setAccounts] = useState(demoAccounts);
  const [activeKey, setActiveKey] = useState(accountKey(demoAccounts[0]));
  const [data, setData] = useState(() => new Map(createDemoData().map((value, i) => [accountKey(demoAccounts[i]), value])));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const active = accounts.find((account) => accountKey(account) === activeKey);
  const selectedData = data.get(activeKey);
  const selectedTask = selection ? data.get(accountKey(selection.account))?.tasks.find((task) => task.id === selection.taskId) : undefined;
  const colors = theme.colors;

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selection) return false;
      setSelection(null);
      setComment('');
      return true;
    });
    return () => listener.remove();
  }, [selection]);

  function updateTask(target: Selection, update: (task: DemoTask) => DemoTask) {
    setData((current) => {
      const key = accountKey(target.account);
      const existing = current.get(key);
      if (!existing) return current;
      return new Map(current).set(key, { ...existing, tasks: existing.tasks.map((task) => task.id === target.taskId ? update(task) : task) });
    });
  }

  function openTask(account: Account, taskId: number) {
    setActiveKey(accountKey(account));
    setSelection({ account, taskId });
    setComment('');
  }

  function disconnect(account: Account) {
    const key = accountKey(account);
    const remaining = accounts.filter((item) => accountKey(item) !== key);
    setAccounts(remaining);
    setData((current) => { const next = new Map(current); next.delete(key); return next; });
    if (activeKey === key) setActiveKey(remaining[0] ? accountKey(remaining[0]) : '');
    setSelection(null);
    setProject(null);
  }

  const caption = (value: string) => <Text textStyle={{ color: colors.secondary, fontSize: 13 }}>{value}</Text>;
  const title = (value: string) => <Text textStyle={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>{value}</Text>;
  const card = (key: string, children: ReactNode) => <Column key={key} spacing={12} style={{ width: '100%', padding: 20, backgroundColor: colors.surface, borderRadius: theme.radius.card, borderWidth: 1, borderColor: colors.border }}>{children}</Column>;

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <StatusBar style="dark" />
    <Host colorScheme="light" seedColor={colors.primary} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={{ width: '100%', height: '100%' }}>
        <Column spacing={20} style={{ width: '100%', padding: theme.spacing.large }}>
          <Text textStyle={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>It’s a Plan</Text>
          <Column spacing={8} style={{ width: '100%', padding: 16, backgroundColor: colors.muted, borderRadius: theme.radius.control }}>
            <Text textStyle={{ color: colors.primary, fontWeight: '700' }}>ETKİLEŞİMLİ DEMO</Text>
            {caption('Örnek veriler · Sunucu bağlantısı ve push yok. Değişiklikler bu oturumda tutulur.')}
          </Column>
          <ScrollView direction="horizontal" style={{ width: '100%' }}>
            <Row spacing={8}>{(['Görevler', 'Projeler', 'Bildirimler', 'Hesaplar'] as Tab[]).map((item) => <Button key={item} label={item} variant={tab === item ? 'filled' : 'outlined'} onPress={() => { setTab(item); setSelection(null); setComment(''); }} testID={`tab-${item}`} />)}</Row>
          </ScrollView>
          {selection && selectedTask ? <>
            <Button label="Geri" variant="text" onPress={() => { setSelection(null); setComment(''); }} />
            {caption(`${selection.account.label} · ${selection.account.server}`)}
            {title(selectedTask.title)}
            {card('detail', <>
              {caption(`${selectedTask.identifier} · ${selectedTask.project}`)}
              <Text textStyle={{ color: colors.text, fontSize: 16 }}>{selectedTask.description}</Text>
              <Text textStyle={{ color: colors.primary, fontWeight: '700' }}>{selectedTask.state}</Text>
              <Button label={selectedTask.state === 'Tamamlandı' ? 'Yeniden aç (demo)' : 'Tamamla (demo)'} onPress={() => updateTask(selection, (task) => ({ ...task, state: task.state === 'Tamamlandı' ? 'Yapılacak' : 'Tamamlandı' }))} />
            </>)}
            {title('Yorumlar')}
            {selectedTask.comments.length === 0 && caption('Henüz örnek yorum yok.')}
            {selectedTask.comments.map((text, i) => card(`comment-${i}`, <Text textStyle={{ color: colors.text }}>{text}</Text>))}
            <TextInput key={resourceKey(selection.account, 'comment', selectedTask.id)} placeholder="Örnek yorum yaz…" multiline onChangeText={setComment} style={{ width: '100%', padding: 16, borderRadius: theme.radius.control, backgroundColor: colors.surface }} />
            <Button label="Yorum ekle (demo)" disabled={!comment.trim()} onPress={() => {
              updateTask(selection, (task) => ({ ...task, comments: [...task.comments, comment.trim()] }));
              setComment('');
              setSelection(null);
            }} />
          </> : <>
            {title(tab === 'Görevler' ? 'Bugün, bir adım daha.' : tab)}
            {(tab === 'Görevler' || tab === 'Projeler') && <>
              {caption(active ? `${active.label} · ${active.server}` : 'Örnek hesapların bağlantısı kesildi.')}
              <ScrollView direction="horizontal" style={{ width: '100%' }}><Row spacing={8}>{accounts.map((account) => <Button key={accountKey(account)} label={account.label} variant={accountKey(account) === activeKey ? 'filled' : 'outlined'} onPress={() => { setActiveKey(accountKey(account)); setProject(null); }} />)}</Row></ScrollView>
              {tab === 'Görevler' && <>
                {project && <Button label={`${project} · Filtreyi temizle`} variant="text" onPress={() => setProject(null)} />}
                {selectedData?.tasks.filter((task) => !project || task.project === project).map((task) => card(resourceKey(active!, 'task', task.id), <>
                  {caption(`${task.identifier} · ${task.project}`)}
                  <Text textStyle={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>{task.title}</Text>
                  <Text textStyle={{ color: colors.primary }}>{task.state}</Text>
                  <Button label="Görevi aç" variant="outlined" onPress={() => openTask(active!, task.id)} />
                </>))}
              </>}
              {tab === 'Projeler' && [...new Set(selectedData?.tasks.map((task) => task.project))].map((name) => card(name, <>
                <Text textStyle={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>{name}</Text>
                {caption(`${selectedData!.tasks.filter((task) => task.project === name).length} örnek görev`)}
                <Button label="Görevleri göster" onPress={() => { setProject(name); setTab('Görevler'); }} />
              </>))}
            </>}
            {tab === 'Bildirimler' && <>
              {caption('Tüm örnek hesaplar · Her kart kendi kaynak hesabını açar.')}
              {accounts.length === 0 && caption('Bağlı örnek hesap yok.')}
              {accounts.flatMap((account) => (data.get(accountKey(account))?.notifications ?? []).map((notification) => card(resourceKey(account, 'notification', notification.id), <>
                <Text textStyle={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>{notification.text}</Text>
                {caption(`${account.label} · ${account.server}`)}
                <Button label="Kaynak görevi aç" onPress={() => openTask(account, notification.taskId)} />
              </>)))}
            </>}
            {tab === 'Hesaplar' && <>
              {accounts.map((account) => card(accountKey(account), <>
                <Text textStyle={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>{account.label}</Text>
                {caption(account.server)}
                <Switch label="Bildirimler (yalnızca demo tercihi)" value={data.get(accountKey(account))?.notificationsEnabled ?? false} onValueChange={(value) => setData((current) => {
                  const key = accountKey(account); const entry = current.get(key);
                  return entry ? new Map(current).set(key, { ...entry, notificationsEnabled: value }) : current;
                })} />
                <Button label="Örnek hesabı kaldır" variant="outlined" onPress={() => disconnect(account)} />
              </>))}
              {caption('Gerçek sunucu ekleme ve oturum açma, upstream auth uyumluluğu doğrulandıktan sonra bağlanacak.')}
              <ThemeEditor theme={theme} onChange={setTheme} />
              {accounts.length === 0 && <Button label="Demoyu yeniden başlat" onPress={() => {
                setAccounts(demoAccounts); setData(new Map(createDemoData().map((value, i) => [accountKey(demoAccounts[i]), value]))); setActiveKey(accountKey(demoAccounts[0]));
              }} />}
            </>}
          </>}
          {caption(`01 / Sakin · ${Platform.OS} · AGPL-3.0-only`)}
        </Column>
      </ScrollView>
    </Host>
  </View>;
}

function ThemeEditor({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const [primary, setPrimary] = useState(theme.colors.primary);
  return <Column spacing={12} style={{ width: '100%' }}>
    <Text textStyle={{ color: theme.colors.text, fontSize: 20, fontWeight: '600' }}>Görünüm</Text>
    <Text textStyle={{ color: theme.colors.secondary }}>Ana renk · #RRGGBB</Text>
    <TextInput defaultValue={primary} autoCapitalize="none" autoCorrect={false} maxLength={7} onChangeText={setPrimary} style={{ padding: 16, width: '100%', backgroundColor: theme.colors.surface, borderRadius: theme.radius.control }} />
    <Button label="Rengi uygula" disabled={!/^#[0-9a-f]{6}$/i.test(primary)} onPress={() => onChange({ ...theme, colors: { ...theme.colors, primary } })} />
  </Column>;
}
