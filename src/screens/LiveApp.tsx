import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler } from 'react-native';
import { Host, ScrollView, Column as Stack, Row, Text, Button, TextInput } from '@expo/ui';
import { StatusBar } from 'expo-status-bar';
import { accountKey, resourceKey } from '../domain/accounts';
import { acknowledgeRead, appendInboxPage, mergeInbox, notificationLabel } from '../domain/inbox';
import { plannerClient } from '../api/nativeClient';
import { connectedAccounts } from '../storage/connectedAccounts';
import { ApiError, type ConnectedAccount, type Project, type Issue, type IssueSummary, type Column, type Comment, type Page, type InboxItem } from '../api/client';
import { sakinTheme } from '../theme';

const colors = sakinTheme.colors;
type Snapshot = { status: 'loading' | 'ready' | 'unavailable' | 'expired'; projects: Project[]; inbox?: Page<InboxItem> };
type Selection = { account: ConnectedAccount; issue: Issue; columns: Column[]; comments: Page<Comment> };
type Tab = 'Projeler' | 'Bildirimler' | 'Hesaplar';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'expired') return 'Oturum doğrulanamadı. Bu hesaba yeniden giriş yap.';
    if (error.code === 'forbidden') return 'Sunucu izin vermedi. Giriş adresini ve hesap yetkilerini kontrol et.';
    if (error.code === 'unsupported') return 'Sunucu veya giriş yöntemi desteklenmiyor. HTTPS API adresini kontrol et.';
    if (error.code === 'invalid-response') return 'Sunucu yanıtı beklenen API biçimiyle eşleşmiyor.';
    if (error.code === 'redirect') return 'Sunucu başka bir adrese yönlendiriyor. Doğrudan API adresini kullan.';
  }
  return 'İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden dene.';
}
function Caption({ children }: { children: string }) { return <Text textStyle={{ color: colors.secondary, fontSize: 13 }}>{children}</Text>; }
function Title({ children }: { children: string }) { return <Text textStyle={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>{children}</Text>; }
function Card({ children }: { children: ReactNode }) { return <Stack spacing={12} style={{ width: '100%', padding: 20, backgroundColor: colors.surface, borderRadius: sakinTheme.radius.card, borderWidth: 1, borderColor: colors.border }}>{children}</Stack>; }

export function LiveApp() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [snapshots, setSnapshots] = useState(new Map<string, Snapshot>());
  const [tab, setTab] = useState<Tab>('Projeler');
  const [notice, setNotice] = useState('');
  const [restoring, setRestoring] = useState(true);
  const [pending, setPending] = useState(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [listing, setListing] = useState<{ account: ConnectedAccount; project: Project; issues: IssueSummary[] } | null>(null);
  const [comment, setComment] = useState('');
  const [commentVersion, setCommentVersion] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const requests = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  const navigation = useRef(0);
  const navigationAccount = useRef<string | null>(null);
  const busyFor = (account?: ConnectedAccount) => pending.has(account ? accountKey(account) : 'login');
  const busy = busyFor(selection?.account ?? listing?.account);
  const inboxSources = accounts.flatMap((account) => {
    const page = snapshots.get(accountKey(account))?.inbox;
    return page ? [{ account, page }] : [];
  });
  const inboxEntries = mergeInbox(inboxSources, unreadOnly);
  const loadedUnread = mergeInbox(inboxSources, true).length;

  useEffect(() => {
    alive.current = true;
    void connectedAccounts.list().then((items) => {
      if (!alive.current) return;
      setAccounts(items);
      for (const account of items) void refresh(account);
    }).catch(() => { if (alive.current) setNotice('Yerel hesap listesi okunamadı. Kayıtlar korunuyor.'); })
      .finally(() => { if (alive.current) setRestoring(false); });
    return () => { alive.current = false; navigation.current++; for (const request of requests.current.values()) request.abort(); };
  }, []);

  useEffect(() => {
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', (state) => {
      const resumed = state === 'active' && previous !== 'active';
      previous = state;
      if (resumed) for (const account of accounts) void refresh(account);
    });
    return () => listener.remove();
  }, [accounts]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selection && !listing) return false;
      navigation.current++;
      if (selection) setSelection(null); else setListing(null);
      setComment('');
      return true;
    });
    return () => listener.remove();
  }, [selection, listing]);

  function expireAccount(account: ConnectedAccount) {
    const key = accountKey(account);
    if (navigationAccount.current === key) { navigation.current++; navigationAccount.current = null; }
    requests.current.get(key)?.abort();
    setSnapshots((current) => new Map(current).set(key, { status: 'expired', projects: [] }));
    setSelection((current) => current && accountKey(current.account) === key ? null : current);
    setListing((current) => current && accountKey(current.account) === key ? null : current);
  }

  async function refresh(account: ConnectedAccount) {
    const key = accountKey(account);
    if (pendingRef.current.has(key)) return;
    requests.current.get(key)?.abort();
    const controller = new AbortController();
    requests.current.set(key, controller);
    setSnapshots((previous) => new Map(previous).set(key, { status: 'loading', projects: [] }));
    try {
      const credential = await connectedAccounts.credential(account);
      await plannerClient.me(account, credential);
      const projects = await plannerClient.projects(account, credential, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setSnapshots((previous) => new Map(previous).set(key, { status: 'ready', projects }));
      const inbox = await plannerClient.inbox(account, credential, undefined, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setSnapshots((previous) => new Map(previous).set(key, { status: 'ready', projects, inbox }));
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      if (error instanceof ApiError && error.code === 'expired') { expireAccount(account); return; }
      setSnapshots((previous) => {
        const next = new Map(previous); const entry = next.get(key);
        next.set(key, { status: 'unavailable', projects: entry?.projects ?? [] });
        return next;
      });
    }
  }

  async function act(work: () => Promise<unknown>, account = selection?.account ?? listing?.account) {
    const key = account ? accountKey(account) : 'login';
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setNotice('');
    try { await work(); } catch (error) {
      if (!alive.current) return;
      if (account && error instanceof ApiError && error.code === 'expired') {
        expireAccount(account);
      }
      setNotice(`${account?.label ?? 'Giriş'}: ${errorText(error)}`);
    }
    finally { pendingRef.current.delete(key); if (alive.current) setPending(new Set(pendingRef.current)); }
  }
  async function openProject(account: ConnectedAccount, project: Project) {
    navigationAccount.current = accountKey(account);
    const version = ++navigation.current;
    const credential = await connectedAccounts.credential(account);
    const issues = await plannerClient.issues(account, credential, project);
    if (alive.current && navigation.current === version) { setListing({ account, project, issues }); setSelection(null); }
  }
  async function openIssue(account: ConnectedAccount, issueId: number, project?: Project) {
    navigationAccount.current = accountKey(account);
    const version = ++navigation.current;
    const credential = await connectedAccounts.credential(account);
    const issue = await plannerClient.detail(account, credential, issueId);
    const resolvedProject = project ?? snapshots.get(accountKey(account))?.projects.find((item) => item.id === issue.projectId);
    if (!resolvedProject || resolvedProject.id !== issue.projectId) throw new ApiError('forbidden');
    const [columns, comments] = await Promise.all([plannerClient.columns(account, credential, resolvedProject), plannerClient.comments(account, credential, issue.id)]);
    if (alive.current && navigation.current === version) { setSelection({ account, issue, columns, comments }); setComment(''); setCommentVersion((value) => value + 1); return true; }
    return false;
  }

  async function setRead(account: ConnectedAccount, id: number, read: boolean) {
    const key = accountKey(account);
    const request = requests.current.get(key);
    const credential = await connectedAccounts.credential(account);
    await plannerClient.setNotificationRead(account, credential, id, read);
    if (!alive.current || request !== requests.current.get(key) || request?.signal.aborted) return;
    setSnapshots((current) => {
      const entry = current.get(key);
      return entry?.inbox ? new Map(current).set(key, { ...entry, inbox: acknowledgeRead(entry.inbox, id, read, new Date().toISOString()) }) : current;
    });
  }

  async function moreInbox(account: ConnectedAccount) {
    const key = accountKey(account);
    const page = snapshots.get(key)?.inbox;
    if (page?.nextCursor == null) return;
    const request = requests.current.get(key);
    const credential = await connectedAccounts.credential(account);
    const next = await plannerClient.inbox(account, credential, page.nextCursor);
    if (!alive.current || request !== requests.current.get(key) || request?.signal.aborted) return;
    setSnapshots((current) => {
      const entry = current.get(key);
      return entry?.inbox ? new Map(current).set(key, { ...entry, inbox: appendInboxPage(entry.inbox, next) }) : current;
    });
  }

  return <>
    <StatusBar style="dark" />
    <Host colorScheme="light" seedColor={colors.primary} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={{ width: '100%', height: '100%' }}><Stack spacing={20} style={{ width: '100%', padding: 24 }}>
        <Title>It’s a Plan</Title><Caption>Self-host sunucuların · Hesapların birbirinden ayrı tutulur.</Caption>
        <ScrollView direction="horizontal" style={{ width: '100%' }}><Row spacing={8}>{(['Projeler', 'Bildirimler', 'Hesaplar'] as Tab[]).map((value) => <Button key={value} label={value} variant={tab === value ? 'filled' : 'outlined'} onPress={() => { navigation.current++; setTab(value); setSelection(null); setListing(null); setNotice(''); }} />)}</Row></ScrollView>
        {pending.size > 0 && <Caption>İşlem sürüyor…</Caption>}
        {notice && <Text textStyle={{ color: colors.danger }}>{notice}</Text>}
        {restoring && <Caption>Hesaplar yükleniyor…</Caption>}
        {selection ? <>
          <Button label="Geri" variant="text" onPress={() => { navigation.current++; setSelection(null); }} />
          <Caption>{`${selection.account.label} · ${selection.account.server}`}</Caption>
          <Title>{`${selection.issue.identifier} · ${selection.issue.title}`}</Title>
          <Text textStyle={{ color: colors.text }}>{selection.issue.description || 'Açıklama yok.'}</Text>
          <Title>Durum</Title>
          {selection.columns.map((column) => <Button key={column.id} label={column.name} variant={column.id === selection.issue.columnId ? 'filled' : 'outlined'} disabled={busy || column.id === selection.issue.columnId} onPress={() => void act(async () => {
            const credential = await connectedAccounts.credential(selection.account);
            const issue = await plannerClient.updateState(selection.account, credential, selection.issue.id, column.id);
            if (alive.current) setSelection((current) => current && accountKey(current.account) === accountKey(selection.account) && current.issue.id === issue.id ? { ...current, issue } : current);
          })} />)}
          <Title>Yorumlar</Title>
          {selection.comments.items.length === 0 && <Caption>Henüz yorum yok.</Caption>}
          {selection.comments.items.map((entry) => <Card key={entry.id}><Caption>{entry.actorName ?? 'Üye'}</Caption><Text textStyle={{ color: colors.text }}>{entry.body ?? ''}</Text></Card>)}
          {selection.comments.nextCursor != null && <Button label="Daha fazla yorum" disabled={busy} onPress={() => void act(async () => {
            const credential = await connectedAccounts.credential(selection.account);
            const next = await plannerClient.comments(selection.account, credential, selection.issue.id, selection.comments.nextCursor);
            if (alive.current) setSelection((current) => current === selection ? { ...current, comments: { items: [...current.comments.items, ...next.items], nextCursor: next.nextCursor } } : current);
          })} />}
          <TextInput key={`${resourceKey(selection.account, 'comment', selection.issue.id)}-${commentVersion}`} placeholder="Yorum yaz…" multiline onChangeText={setComment} style={{ width: '100%', padding: 16, backgroundColor: colors.surface, borderRadius: 14 }} />
          <Button label="Yorumu gönder" disabled={busy || !comment.trim()} onPress={() => void act(async () => {
            const credential = await connectedAccounts.credential(selection.account);
            const version = navigation.current;
            await plannerClient.addComment(selection.account, credential, selection.issue.id, comment);
            if (alive.current && navigation.current === version) await openIssue(selection.account, selection.issue.id);
          })} />
        </> : listing ? <>
          <Button label="Projelere dön" variant="text" onPress={() => { navigation.current++; setListing(null); }} />
          <Title>{listing.project.name}</Title><Caption>{`${listing.account.label} · Sana atanan görevler (en fazla 500)`}</Caption>
          {listing.issues.length === 0 && <Caption>Bu projede sana atanmış görev yok.</Caption>}
          {listing.issues.map((issue) => <Card key={resourceKey(listing.account, 'issue', issue.id)}><Caption>{issue.identifier}</Caption><Title>{issue.title}</Title><Button label="Görevi aç" disabled={busy} onPress={() => void act(() => openIssue(listing.account, issue.id, listing.project))} /></Card>)}
        </> : <>
          {accounts.map((account) => {
            const snapshot = snapshots.get(accountKey(account));
            return <Card key={accountKey(account)}>
              <Title>{account.label}</Title><Caption>{account.server}</Caption>
              <Caption>{snapshot?.status === 'ready' ? 'Bağlı' : snapshot?.status === 'expired' ? 'Yeniden giriş gerekli' : snapshot?.status === 'unavailable' ? 'Bu sunucuya erişilemiyor' : 'Bağlanıyor…'}</Caption>
              <Button label="Yenile" variant="text" disabled={busyFor(account)} onPress={() => void refresh(account)} />
              {tab === 'Projeler' && snapshot?.projects.map((project) => <Button key={project.ref} label={project.name} variant="outlined" disabled={busyFor(account)} onPress={() => void act(() => openProject(account, project), account)} />)}
              {tab === 'Projeler' && snapshot?.status === 'ready' && snapshot.projects.length === 0 && <Caption>Henüz erişilebilir proje yok.</Caption>}
              {tab === 'Bildirimler' && snapshot?.inbox?.nextCursor != null && <Button label={`${account.label}: daha fazla yükle`} disabled={busyFor(account)} onPress={() => void act(() => moreInbox(account), account)} />}
              {tab === 'Bildirimler' && snapshot?.inbox?.items.length === 0 && <Caption>Bildirim yok.</Caption>}
              {tab === 'Hesaplar' && <>
                <Caption>Push ve cihaz kaydı henüz bağlı değil. Çıkış, bu hesabın sunucu oturumunu kapatır.</Caption>
                <Button label="Hesaptan çıkış yap" disabled={busyFor(account)} variant="outlined" onPress={() => void act(async () => {
                  requests.current.get(accountKey(account))?.abort();
                  await connectedAccounts.disconnect(account);
                  if (alive.current) { setAccounts((current) => current.filter((entry) => accountKey(entry) !== accountKey(account))); setSnapshots((current) => { const next = new Map(current); next.delete(accountKey(account)); return next; }); }
                }, account)} />
              </>}
            </Card>;
          })}
          {tab === 'Bildirimler' && <>
            <Title>Ortak bildirim kutusu</Title>
            <Caption>{`Yüklenenlerde ${loadedUnread} okunmamış · Yüklenen bildirimler en yeniden eskiye sıralanır.`}</Caption>
            <Button label={unreadOnly ? 'Tüm yüklenenleri göster' : 'Yalnızca okunmamışlar'} variant="outlined" onPress={() => setUnreadOnly((value) => !value)} />
            {inboxEntries.length === 0 && <Caption>{unreadOnly ? 'Yüklenenlerde okunmamış bildirim yok.' : 'Henüz yüklenmiş bildirim yok.'}</Caption>}
            {inboxEntries.map(({ account, item, key }) => <Card key={key}>
              <Caption>{`${account.label} · ${account.server}`}</Caption>
              <Caption>{`${item.projectName} · ${notificationLabel(item.type)} · ${new Date(item.createdAt).toLocaleString('tr-TR')}`}</Caption>
              <Text textStyle={{ color: colors.text, fontSize: 18, fontWeight: item.readAt === null ? '700' : 'normal' }}>{item.issueTitle ?? item.documentTitle ?? 'Bildirim'}</Text>
              <Caption>{item.readAt === null ? 'Okunmadı' : 'Okundu'}</Caption>
              {item.issueId !== null ? <Button label="Kaynak görevi aç" disabled={busyFor(account)} onPress={() => void act(async () => {
                const opened = await openIssue(account, item.issueId!);
                if (opened && item.readAt === null) await setRead(account, item.id, true);
              }, account)} /> : <Caption>Belge görüntüleme bu sürümde desteklenmiyor.</Caption>}
              <Button label={item.readAt === null ? 'Okundu işaretle' : 'Okunmadı işaretle'} variant="outlined" disabled={busyFor(account)} onPress={() => void act(() => setRead(account, item.id, item.readAt === null), account)} />
            </Card>)}
          </>}
          {(tab === 'Hesaplar' || (!restoring && accounts.length === 0)) && <LoginForm busy={busy} onLogin={(server, origin, identifier, password) => act(async () => {
            const account = await connectedAccounts.signIn(server, origin, identifier, password);
            if (!alive.current) return;
            setAccounts(await connectedAccounts.list()); void refresh(account);
          })} />}
        </>}
      </Stack></ScrollView>
    </Host>
  </>;
}

function LoginForm({ busy, onLogin }: { busy: boolean; onLogin: (server: string, origin: string, identifier: string, password: string) => Promise<void> }) {
  const [server, setServer] = useState(''); const [origin, setOrigin] = useState('');
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState('');
  const [passwordKey, setPasswordKey] = useState(0);
  const style = { width: '100%' as const, padding: 16, backgroundColor: colors.background, borderRadius: 14 };
  return <Card>
    <Title>Sunucuya bağlan</Title>
    <Caption>Yalnızca güvendiğin HTTPS sunucularına giriş yap. API ve web giriş adresleri farklı olabilir.</Caption>
    <TextInput placeholder="HTTPS API adresi" autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setServer} style={style} />
    <TextInput placeholder="Web giriş adresi (API ile aynıysa boş bırak)" autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setOrigin} style={style} />
    <TextInput placeholder="E-posta veya kullanıcı adı" autoCapitalize="none" autoCorrect={false} onChangeText={setIdentifier} style={style} />
    <TextInput key={passwordKey} placeholder="Parola" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" onChangeText={setPassword} style={style} />
    <Caption>Parola kaydedilmez. Oturum güvenli saklanır. SSO ve geçiş anahtarı girişi henüz desteklenmiyor.</Caption>
    <Button label="Giriş yap" disabled={busy || !server.trim() || !identifier.trim() || !password} onPress={() => {
      const entered = password; setPassword(''); setPasswordKey((value) => value + 1);
      void onLogin(server.trim(), origin.trim() || server.trim(), identifier.trim(), entered);
    }} />
  </Card>;
}
