import { createServer } from 'node:http';
import { Readable } from 'node:stream';

export function serve(handler: (request: Request) => Promise<Response>, port: number) {
  return createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (incoming, outgoing) => {
    try {
      const init = { method: incoming.method, headers: incoming.headers as HeadersInit,
        body: ['GET','HEAD'].includes(incoming.method ?? '') ? undefined : Readable.toWeb(incoming), duplex: 'half' };
      const response = await handler(new Request(new URL(incoming.url ?? '/', 'http://gateway.internal'), init as RequestInit));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(outgoing);
      else outgoing.end();
    } catch { outgoing.writeHead(503, { 'Content-Type': 'application/json' }); outgoing.end('{"error":"service_unavailable"}'); }
  }).listen(port, '0.0.0.0');
}
