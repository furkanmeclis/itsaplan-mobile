import { normalizeServer, type Account } from '../domain/accounts';

export interface ConnectedAccount extends Account { webOrigin: string }
export interface User { id: string; name: string; email: string }
export interface Project { id: number; ref: string; name: string }
export interface Issue { id: number; projectId: number; identifier: string; title: string; description: string; columnId: number }
export type IssueSummary = Omit<Issue, 'description'>;
export interface Column { id: number; name: string; stateType: string }
export interface InboxItem { id: number; projectId: number; projectName: string; issueId: number | null; issueTitle: string | null; documentTitle: string | null; type: string; readAt: string | null; createdAt: string }
export interface Comment { id: number; body: string | null; actorName: string | null }
export interface Page<T> { items: T[]; nextCursor: unknown }
export interface Credential { cookie: string }
export const credentialPattern = /^(?:__Host-|__Secure-)?better-auth\.session_token=[A-Za-z0-9._~%+/=-]+$/;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type Failure = 'network' | 'timeout' | 'expired' | 'forbidden' | 'unsupported' | 'invalid-response' | 'redirect';

export class ApiError extends Error {
  constructor(readonly code: Failure, readonly status?: number) { super(code); }
}

export function normalizeWebOrigin(value: string): string {
  return new URL(normalizeServer(value)).origin;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid-response');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('invalid-response');
  return value;
}
function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new ApiError('invalid-response');
  return value as number;
}
function list<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ApiError('invalid-response');
  return value.map(parse);
}
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function timestamp(value: unknown): string {
  const result = string(value);
  if (!Number.isFinite(Date.parse(result))) throw new ApiError('invalid-response');
  return result;
}
export function parseUser(value: unknown): User {
  const item = object(value);
  const user = { id: string(item.id), name: string(item.name), email: string(item.email) };
  if (!user.id) throw new ApiError('invalid-response');
  return user;
}
function parseProject(value: unknown): Project {
  const item = object(value);
  return { id: number(item.id), ref: string(item.ref), name: string(item.name) };
}
function parseIssue(value: unknown): Issue {
  const item = object(value);
  return { id: number(item.id), projectId: number(item.projectId), identifier: string(item.identifier), title: string(item.title), description: string(item.description), columnId: number(item.columnId) };
}
function parseInbox(value: unknown): InboxItem {
  const item = object(value);
  return { id: number(item.id), projectId: number(item.projectId), projectName: string(item.projectName), issueId: item.issueId === null ? null : number(item.issueId), issueTitle: nullableString(item.issueTitle), documentTitle: nullableString(item.documentTitle), type: string(item.type), readAt: item.readAt === null ? null : timestamp(item.readAt), createdAt: timestamp(item.createdAt) };
}
function parsePage<T>(value: unknown, parse: (value: unknown) => T): Page<T> {
  const item = object(value);
  if (!('nextCursor' in item)) throw new ApiError('invalid-response');
  return { items: list(item.items, parse), nextCursor: item.nextCursor };
}

export function sessionCookie(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const lines = (getSetCookie ? getSetCookie.call(headers) : [headers.get('set-cookie') ?? '']).flatMap((line) => line.split(/,(?=\s*[^;,\s]+=)/));
  const candidates = lines.filter((line) => /^(?:__Host-|__Secure-)?better-auth\.session_token=/.test(line.trim()));
  if (candidates.length !== 1) throw new ApiError('unsupported');
  const line = candidates[0].trim();
  const pair = line.split(';')[0];
  const maxAge = line.match(/;\s*Max-Age=([^;]+)/i)?.[1];
  const expires = line.match(/;\s*Expires=([^;]+)/i)?.[1];
  if (!credentialPattern.test(pair) || pair.length > 1800 ||
    !/;\s*Secure(?:;|$)/i.test(line) || !/;\s*HttpOnly(?:;|$)/i.test(line) ||
    (maxAge !== undefined && (!Number.isFinite(Number(maxAge)) || Number(maxAge) <= 0)) ||
    (maxAge === undefined && expires !== undefined && (!Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now()))) throw new ApiError('unsupported');
  return pair;
}

export class PlannerClient {
  constructor(private fetcher: Fetcher, private timeoutMs = 10000) {}

  private async request(server: string, path: string, options: { method?: string; body?: unknown; credential?: Credential; webOrigin?: string; signal?: AbortSignal } = {}): Promise<{ value: unknown; headers: Headers }> {
    const base = normalizeServer(server);
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(path)) throw new ApiError('unsupported');
    const url = `${base}${path}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async () => {
        const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache', Pragma: 'no-cache' };
        if (options.credential) {
          if (!credentialPattern.test(options.credential.cookie)) throw new ApiError('expired');
          headers.Cookie = options.credential.cookie;
        }
        if (options.webOrigin) headers.Origin = normalizeWebOrigin(options.webOrigin);
        const response = await this.fetcher(url, { method: options.method ?? 'GET', body: options.body === undefined ? undefined : JSON.stringify(options.body), headers, credentials: 'omit', redirect: 'error', signal: controller.signal });
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ApiError('redirect');
        if (response.url && new URL(response.url).origin !== new URL(base).origin) throw new ApiError('redirect');
        if (!response.ok) throw new ApiError(response.status === 401 ? 'expired' : response.status === 403 ? 'forbidden' : 'invalid-response', response.status);
        if (response.status === 204) return { value: null, headers: response.headers };
        if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('invalid-response');
        const reader = response.body?.getReader();
        if (!reader) throw new ApiError('invalid-response');
        const decoder = new TextDecoder();
        let body = ''; let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 2_000_000) { await reader.cancel(); throw new ApiError('invalid-response'); }
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
        } finally { reader.releaseLock(); }
        try { return { value: JSON.parse(body) as unknown, headers: response.headers }; }
        catch { throw new ApiError('invalid-response'); }
      };
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ApiError('timeout')); }, this.timeoutMs); });
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('network');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async discover(server: string): Promise<{ password: boolean }> {
    const health = object((await this.request(server, '/')).value);
    if (health.name !== "It's a Plan api" || health.status !== 'ok') throw new ApiError('unsupported');
    const config = object((await this.request(server, '/auth-config')).value);
    if (typeof config.emailPassword !== 'boolean') throw new ApiError('unsupported');
    return { password: config.emailPassword };
  }

  async signIn(server: string, webOrigin: string, identifier: string, password: string): Promise<{ account: ConnectedAccount; credential: Credential }> {
    const normalized = normalizeServer(server);
    const origin = normalizeWebOrigin(webOrigin);
    if (!(await this.discover(normalized)).password) throw new ApiError('unsupported');
    const login = identifier.trim();
    const email = login.includes('@');
    const response = await this.request(normalized, `/api/auth/sign-in/${email ? 'email' : 'username'}`, { method: 'POST', webOrigin: origin, body: { [email ? 'email' : 'username']: login, password } });
    const credential = { cookie: sessionCookie(response.headers) };
    const user = parseUser(object(response.value).user);
    const verified = await this.me({ server: normalized, userId: user.id, label: user.name, webOrigin: origin }, credential);
    return { account: { server: normalized, userId: verified.id, label: verified.name, webOrigin: origin }, credential };
  }

  async me(account: ConnectedAccount, credential: Credential): Promise<User> {
    const value = object((await this.request(account.server, '/me', { credential })).value);
    if (value.authenticated !== true) throw new ApiError('expired');
    const user = parseUser(value.user);
    if (user.id !== account.userId) throw new ApiError('expired');
    return user;
  }

  async projects(account: ConnectedAccount, credential: Credential, signal?: AbortSignal): Promise<Project[]> {
    return list((await this.request(account.server, '/projects', { credential, signal })).value, parseProject);
  }
  async issues(account: ConnectedAccount, credential: Credential, project: Project, signal?: AbortSignal): Promise<IssueSummary[]> {
    const query = new URLSearchParams({ assigneeUserId: account.userId, limit: '500' });
    return list((await this.request(account.server, `/projects/${encodeURIComponent(project.ref)}/issues?${query}`, { credential, signal })).value, (value) => {
      const item = object(value);
      return { id: number(item.id), projectId: number(project.id), identifier: string(item.identifier), title: string(item.title), columnId: number(item.columnId) };
    });
  }
  async detail(account: ConnectedAccount, credential: Credential, id: number): Promise<Issue> {
    return parseIssue((await this.request(account.server, `/issues/${number(id)}`, { credential })).value);
  }
  async columns(account: ConnectedAccount, credential: Credential, project: Project): Promise<Column[]> {
    const scaffold = object((await this.request(account.server, `/projects/${encodeURIComponent(project.ref)}`, { credential })).value);
    return list(scaffold.columns, (value) => { const item = object(value); return { id: number(item.id), name: string(item.name), stateType: string(item.stateType) }; });
  }
  async updateState(account: ConnectedAccount, credential: Credential, id: number, columnId: number): Promise<Issue> {
    return parseIssue((await this.request(account.server, `/issues/${number(id)}`, { method: 'PATCH', credential, body: { columnId: number(columnId) } })).value);
  }
  async comments(account: ConnectedAccount, credential: Credential, id: number, cursor?: unknown): Promise<Page<Comment>> {
    const query = new URLSearchParams({ filter: 'comments', limit: '50' });
    if (cursor != null) query.set('cursor', JSON.stringify(cursor));
    return parsePage((await this.request(account.server, `/issues/${number(id)}/feed?${query}`, { credential })).value, (value) => { const item = object(value); return { id: number(item.id), body: nullableString(item.body), actorName: nullableString(item.actorName) }; });
  }
  async addComment(account: ConnectedAccount, credential: Credential, id: number, body: string): Promise<void> {
    if (!body.trim()) throw new ApiError('invalid-response');
    await this.request(account.server, `/issues/${number(id)}/comments`, { method: 'POST', credential, body: { body: body.trim() } });
  }
  async inbox(account: ConnectedAccount, credential: Credential, cursor?: unknown, signal?: AbortSignal): Promise<Page<InboxItem>> {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor != null) query.set('cursor', JSON.stringify(cursor));
    return parsePage((await this.request(account.server, `/notifications?${query}`, { credential, signal })).value, parseInbox);
  }
  async setNotificationRead(account: ConnectedAccount, credential: Credential, id: number, read: boolean): Promise<void> {
    await this.request(account.server, `/notifications/${number(id)}/read`, { method: 'POST', credential, body: { read } });
  }
  async signOut(account: ConnectedAccount, credential: Credential): Promise<void> {
    await this.request(account.server, '/api/auth/sign-out', { method: 'POST', credential, webOrigin: account.webOrigin, body: {} });
  }
}
