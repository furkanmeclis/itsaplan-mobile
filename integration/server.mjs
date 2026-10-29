import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { upstreamRuntime } from '../services/push/src/runtime.ts';
import { workerRuntime } from '../services/push/src/worker-runtime.ts';
import { assertNoOperatorCredentials } from './fixture-environment.mjs';

assertNoOperatorCredentials(process.env);

const { app } = await import(pathToFileURL(`${process.env.UPSTREAM_ROOT}/apps/api/src/app.ts`).href);
const mobile = await upstreamRuntime(process.env.UPSTREAM_ROOT);
const worker = await workerRuntime(process.env.UPSTREAM_ROOT);
let redirectRequests = 0;
let redirectCredentialSeen = false;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.API_PORT),
  tls: { cert: readFileSync(process.env.TEST_CERT), key: readFileSync(process.env.TEST_KEY) },
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/__test/redirect/me') return Response.redirect('https://localhost:34562/__test/credential-sink', 302);
    if (path === '/__test/credential-sink') {
      redirectRequests++;
      redirectCredentialSeen ||= request.headers.has('cookie') || request.headers.has('authorization');
      return Response.json({ ok: true });
    }
    if (path === '/__test/redirect-status') return Response.json({ requests: redirectRequests, credentialSeen: redirectCredentialSeen });
    if (path === '/__test/mobile-tick' && request.method === 'POST' && request.headers.get('authorization') === `Bearer ${process.env.TEST_CONTROL_KEY}`) {
      await worker.tick(); return Response.json({ ok: true });
    }
    return path.startsWith('/mobile/') ? mobile.handler(request) : app.handle(request);
  },
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
