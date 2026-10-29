import { Text } from '../components/Text';
import { useEffect, useState } from 'react';
import { Column, Button, Switch } from '@expo/ui';
import { plannerClient } from '../api/nativeClient';
import { connectedAccounts } from '../storage/connectedAccounts';
import { pushManager } from '../storage/push';
import { pushEvents, type ConnectedAccount, type PushPreferences } from '../api/client';
import { notificationLabel } from '../domain/inbox';
import { sakinTheme } from '../theme';

export function PushSettings({ account, accounts, busy, run }: { account: ConnectedAccount; accounts: ConnectedAccount[]; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const [state, setState] = useState<'loading'|'ready'|'unavailable'|'error'>('loading');
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const credential = await connectedAccounts.credential(account);
      const capabilities = await plannerClient.pushCapabilities(account, credential);
      if (!live) return;
      if (!capabilities?.push) { setState('unavailable'); return; }
      const next = await plannerClient.pushPreferences(account, credential);
      const registration = await pushManager.registration(account);
      if (live) { setPrefs(next); setRegistered(Boolean(registration)); setState('ready'); }
    })().catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [account.server, account.userId, account.webOrigin]);
  const textStyle = { color: sakinTheme.colors.secondary, fontSize: 13 };
  return <Column spacing={12} style={{ width: '100%' }}>
    <Text textStyle={{ color: sakinTheme.colors.text, fontWeight: '700' }}>Push bildirimleri</Text>
    {state === 'loading' && <Text textStyle={textStyle}>Sunucu desteği kontrol ediliyor…</Text>}
    {state === 'unavailable' && <Text textStyle={textStyle}>Sunucuda mobil push eklentisi veya gateway yapılandırması yok. Inbox kullanılabilir.</Text>}
    {state === 'error' && <Text textStyle={textStyle}>Push ayarları okunamadı. Hesabın bağlantısını yenileyip tekrar dene.</Text>}
    {state === 'ready' && prefs && <>
      <Text textStyle={textStyle}>Tercihler bu hesabın tüm cihazları içindir. OS izni ve cihaz kaydı bu telefonda ayrıca gerekir.</Text>
      <Switch label="Bu hesabın push bildirimleri" value={prefs.enabled} disabled={busy} onValueChange={(enabled) => void run(async () => {
        if (enabled) { setPrefs(await pushManager.enable(account, accounts)); setRegistered(true); }
        else setPrefs(await plannerClient.setPushPreferences(account, await connectedAccounts.credential(account), { ...prefs, enabled: false }));
      })} />
      {pushEvents.map((event) => <Switch key={event} label={notificationLabel(event)} value={prefs.events.includes(event)} disabled={busy} onValueChange={(value) => void run(async () => {
        const events = value ? [...prefs.events, event] : prefs.events.filter((item) => item !== event);
        setPrefs(await plannerClient.setPushPreferences(account, await connectedAccounts.credential(account), { ...prefs, events }));
      })} />)}
      <Text textStyle={textStyle}>{registered ? 'Bu cihazın kaydı var. Gerçek teslimat ayrıca cihazda doğrulanmalıdır.' : 'Bu cihaz henüz kayıtlı değil.'}</Text>
      <Button label={registered ? 'Cihaz kaydını yenile' : 'Bu cihazda bildirimleri etkinleştir'} disabled={busy} onPress={() => void run(async () => { setPrefs(await pushManager.enable(account, accounts)); setRegistered(true); })} />
      {registered && <Button label="Yalnızca bu cihazın kaydını kaldır" variant="outlined" disabled={busy} onPress={() => void run(async () => { await pushManager.unregister(account); setRegistered(false); })} />}
      <Button label="Tercihleri yenile" variant="text" disabled={busy} onPress={() => void run(async () => { setPrefs(await plannerClient.pushPreferences(account, await connectedAccounts.credential(account))); setRegistered(Boolean(await pushManager.registration(account))); })} />
    </>}
  </Column>;
}
