import { workerRuntime } from './worker-runtime.ts';
import { pathToFileURL } from 'node:url';

if (!process.env.UPSTREAM_ROOT) throw new Error('UPSTREAM_ROOT required.');
const runtime = await workerRuntime(process.env.UPSTREAM_ROOT);
const [{ startWorkers }, { startPollLoop }] = await Promise.all([
  import(pathToFileURL(`${process.env.UPSTREAM_ROOT}/apps/worker/src/start.ts`).href),
  import(pathToFileURL(`${process.env.UPSTREAM_ROOT}/apps/worker/src/poll-loop.ts`).href),
]);
startWorkers();
const worker = startPollLoop('mobile-push', runtime.tick, () => 1000);
process.on('SIGTERM', () => worker.stop());
