import { upstreamRuntime } from './runtime.ts';
import { pathToFileURL } from 'node:url';

if (!process.env.UPSTREAM_ROOT) throw new Error('UPSTREAM_ROOT required.');
const runtime = await upstreamRuntime(process.env.UPSTREAM_ROOT);
const { startBackgroundJobs } = await import(pathToFileURL(`${process.env.UPSTREAM_ROOT}/apps/api/src/background.ts`).href);
startBackgroundJobs();
const server = Bun.serve({ port: Number(process.env.API_PORT ?? 3000), fetch: (request) =>
  new URL(request.url).pathname.startsWith('/mobile/') ? runtime.handler(request) : runtime.app.handle(request),
});
process.on('SIGTERM', async () => { server.stop(true); await runtime.sql.end(); process.exit(0); });
