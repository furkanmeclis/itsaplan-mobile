import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('A 32-byte base64 encryption key is required.');
  return key;
}
export function encrypt(value: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decrypt(value: string, key: Buffer, context: string): string {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
export const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a: string, b: string): boolean {
  const first = Buffer.from(hashKey(a)); const second = Buffer.from(hashKey(b));
  return timingSafeEqual(first, second);
}
export function httpsEndpoint(input: string, allowLoopback = false): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('HTTPS endpoint required.');
  return url.href.replace(/\/$/, '');
}
