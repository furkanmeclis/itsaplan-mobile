import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import { fetch as nativeFetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Host, Column, Text, Button } from '@expo/ui';
import App from '../App';
import { plannerClient } from '../src/api/nativeClient';
import { ApiError } from '../src/api/client';
import { connectedAccounts } from '../src/storage/connectedAccounts';
import { secureSessionVault } from '../src/storage/secureSessionVault';
import { accountKey } from '../src/domain/accounts';
import { mergeInbox } from '../src/domain/inbox';
import { sakinTheme } from '../src/theme';
import { nativeAccounts, servers, webOrigin, password } from './native-contract-config';

const phaseKey = 'itsaplan.native-contract.phase.v1';
const reportKey = 'itsaplan.native-contract.report.v1';
class ContractFailure extends Error {}
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ContractFailure(code);
}
async function expired(work: () => Promise<unknown>): Promise<boolean> {
  try { await work(); return false; }
  catch (error) { return error instanceof ApiError && error.code === 'expired'; }
}

async function restoreAndVerify(progress: (value: string) => void) {
  const checks = ['three password sessions saved in native SecureStore before process restart'];
  progress('restore_sessions');
  const accounts = await connectedAccounts.list();
  check(accounts.length === 3, 'restored_account_count');
  const entries = [];
  for (const fixture of nativeAccounts) {
    const account = accounts.find((item) => item.server === fixture.server && item.label === fixture.name);
    check(account, 'restored_account_missing');
    const credential = await connectedAccounts.credential(account);
    check((await plannerClient.me(account, credential)).name === fixture.name, 'restored_identity_mismatch');
    entries.push({ account, credential });
  }
  const [a, b, c] = entries;
  check(new Set(accounts.map(accountKey)).size === 3, 'account_scope_collision');
  checks.push('three server/user identities restored from native storage after process restart');

  progress('tasks_and_mutations');
  const projectA = (await plannerClient.projects(a.account, a.credential)).find((item) => item.name === 'First project');
  const projectB = (await plannerClient.projects(b.account, b.credential)).find((item) => item.name === 'Second project');
  check(projectA && projectB, 'source_project_missing');
  const [issueA] = await plannerClient.issues(a.account, a.credential, projectA);
  const [issueB] = await plannerClient.issues(b.account, b.credential, projectB);
  check(issueA && issueB && issueA.id === issueB.id, 'task_id_collision_fixture_missing');
  const detailA = await plannerClient.detail(a.account, a.credential, issueA.id);
  const detailB = await plannerClient.detail(b.account, b.credential, issueB.id);
  check(detailA.title === 'First task' && detailB.title === 'Second task', 'cross_server_task_mix');
  checks.push('equal remote task IDs resolve to their original HTTPS server');
  const target = (await plannerClient.columns(a.account, a.credential, projectA)).find((item) => item.id !== detailA.columnId);
  check(target, 'target_column_missing');
  check((await plannerClient.updateState(a.account, a.credential, issueA.id, target.id)).columnId === target.id, 'state_not_changed');
  check((await plannerClient.detail(b.account, b.credential, issueB.id)).columnId === detailB.columnId, 'cross_server_state_mix');
  const comment = 'Native transport comment';
  await plannerClient.addComment(a.account, a.credential, issueA.id, comment);
  check((await plannerClient.comments(a.account, a.credential, issueA.id)).items.some((item) => item.body?.includes(comment)), 'comment_not_saved');
  check(!(await plannerClient.comments(b.account, b.credential, issueB.id)).items.some((item) => item.body?.includes(comment)), 'cross_server_comment_mix');
  checks.push('native state/comment mutations affect only the originating server');

  progress('inbox_and_credentials');
  const inboxA = await plannerClient.inbox(a.account, a.credential);
  const inboxB = await plannerClient.inbox(b.account, b.credential);
  check(inboxA.items.length === 1 && inboxB.items.length === 1 && inboxA.items[0].id === inboxB.items[0].id, 'inbox_collision_fixture_missing');
  check(mergeInbox([{ account: a.account, page: inboxA }, { account: b.account, page: inboxB }]).length === 2, 'merged_inbox_collision');
  await plannerClient.setNotificationRead(a.account, a.credential, inboxA.items[0].id, true);
  check((await plannerClient.inbox(a.account, a.credential)).items[0].readAt !== null, 'read_not_saved');
  check((await plannerClient.inbox(b.account, b.credential)).items[0].readAt === null, 'cross_server_read_mix');
  checks.push('equal notification IDs merge separately and retain account-scoped read state');
  check(await expired(() => plannerClient.me(b.account, a.credential)), 'foreign_server_credential_accepted');
  check(await expired(() => plannerClient.me(c.account, a.credential)), 'wrong_same_host_identity_accepted');
  checks.push('foreign-server and wrong-user credentials are rejected');

  progress('redirect_isolation');
  let redirectRejected = false;
  try { await plannerClient.me({ ...a.account, server: `${servers[0]}/__test/redirect` }, a.credential); }
  catch (error) { redirectRejected = error instanceof ApiError && ['redirect', 'network'].includes(error.code); }
  check(redirectRejected, 'credential_redirect_not_rejected');
  const redirectResponse = await nativeFetch(`${servers[1]}/__test/redirect-status`, { credentials: 'omit', redirect: 'error' });
  const redirectStatus = await redirectResponse.json();
  check(redirectStatus.requests === 0 && redirectStatus.credentialSeen === false, 'native_transport_followed_credential_redirect');
  checks.push('native redirect refusal prevents a credential-bearing request from reaching another server');

  progress('logout_isolation');
  await connectedAccounts.disconnect(c.account);
  check(await secureSessionVault.read(c.account) === null, 'logged_out_secret_retained');
  check(await expired(() => plannerClient.me(c.account, c.credential)), 'logged_out_session_still_valid');
  check((await connectedAccounts.list()).length === 2, 'logout_index_mismatch');
  check((await plannerClient.me(a.account, a.credential)).name === 'First', 'same_host_logout_leaked');
  check((await plannerClient.me(b.account, b.credential)).name === 'Second', 'cross_server_logout_leaked');
  checks.push('logout revokes one session and removes only its native secret/index entry');
  const report = { formatVersion: 1, platform: Platform.OS, nativeTransport: 'expo/fetch', secureStorage: 'expo-secure-store',
    nativeAuthentication: true, physicalDevice: false, providerDelivery: false, checks };
  await AsyncStorage.setItem(reportKey, JSON.stringify(report));
  await AsyncStorage.setItem(phaseKey, 'interactive');
  return report;
}

type BootstrapResult = { phase: 'interactive' | 'stored' | 'passed'; report?: string };
async function bootstrap(progress: (value: string) => void): Promise<BootstrapResult> {
  check(['android', 'ios'].includes(Platform.OS), 'native_runtime_required');
  const phase = await AsyncStorage.getItem(phaseKey);
  if (phase === 'interactive') return { phase: 'interactive' };
  if (phase === 'stored') return { phase: 'passed', report: JSON.stringify(await restoreAndVerify(progress)) };
  check(phase === null && (await connectedAccounts.list()).length === 0, 'fresh_test_install_required');
  progress('save_sessions');
  for (const account of [nativeAccounts[1], nativeAccounts[0], nativeAccounts[2]]) await connectedAccounts.signIn(account.server, webOrigin, account.email, password);
  check((await connectedAccounts.list()).length === 3, 'stored_account_count');
  await AsyncStorage.setItem(phaseKey, 'stored');
  return { phase: 'stored' };
}

function NativeContractRoot() {
  const [state, setState] = useState('starting');
  const [stage, setStage] = useState('initializing');
  const [report, setReport] = useState('');
  const [showApp, setShowApp] = useState(false);
  const run = useRef<Promise<BootstrapResult> | null>(null);
  useEffect(() => {
    let live = true;
    run.current ??= bootstrap(setStage);
    void run.current.then((result) => {
      if (!live) return;
      if (result.phase === 'interactive') setShowApp(true);
      else if (result.phase === 'stored') setState('NATIVE_CONTRACT_STORAGE_READY');
      else { setReport(result.report ?? ''); setState('NATIVE_CONTRACT_PASSED'); }
    }).catch((error: unknown) => {
      const code = error instanceof ContractFailure ? error.message : error instanceof ApiError ? `api_${error.code}` : 'native_operation_failed';
      if (live) { setReport(code); setState('NATIVE_CONTRACT_FAILED'); }
    });
    return () => { live = false; };
  }, []);
  if (showApp) return <App />;
  return <Host style={{ flex: 1, backgroundColor: sakinTheme.colors.background }} colorScheme="light">
    <Column spacing={16} style={{ padding: 32, width: '100%' }}>
      <Text>CI native contract package</Text>
      <Text testID="native-contract-state">{state}</Text>
      <Text testID="native-contract-stage">{stage}</Text>
      <Text testID="native-contract-report" numberOfLines={1}>{report}</Text>
      {state === 'NATIVE_CONTRACT_PASSED' && <Button label="Open normal app" onPress={() => setShowApp(true)} />}
      <Text>Disposable localhost HTTPS fixtures. No operator key or provider delivery.</Text>
    </Column>
  </Host>;
}

registerRootComponent(NativeContractRoot);
