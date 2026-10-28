import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const { app } = await import(pathToFileURL(`${process.env.UPSTREAM_ROOT}/apps/api/src/app.ts`).href);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.API_PORT),
  tls: { cert: readFileSync(process.env.TEST_CERT), key: readFileSync(process.env.TEST_KEY) },
  fetch: (request) => app.handle(request),
});
process.on('SIGTERM', () => { server.stop(true); process.exit(0); });
