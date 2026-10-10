import { Agent, request } from 'node:http';
import { Readable } from 'node:stream';

// Thousands of bundled assets may load at once. Keep a bounded pool, including
// while response bodies stream, rather than opening one socket per asset.
const agent = new Agent({ keepAlive: true, maxSockets: 12, maxTotalSockets: 12,
  maxFreeSockets: 4, scheduling: 'lifo' });
const resetCodes = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

function readOnce(target, options) {
  return new Promise((resolve, reject) => {
    const req = request(target, { method: options.method, agent, signal: options.signal,
      headers: Object.fromEntries(new Headers(options.headers)) }, incoming => {
      const status = incoming.statusCode;
      if (status >= 300 && status < 400) {
        incoming.destroy(); reject(new Error('Local asset redirects are disabled')); return;
      }
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2)
        headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const empty = options.method === 'HEAD' || [204, 205, 304].includes(status);
      if (empty) incoming.resume();
      resolve(new Response(empty ? null : Readable.toWeb(incoming), { status, headers }));
    });
    req.once('error', reject);
    req.end();
  });
}

export function closeLocalAssetRequests() { agent.destroy(); }

export async function fetchLocalAsset(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' ||
      target.username || target.password) throw new TypeError('Expected local game server');
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method)) throw new TypeError('Expected read-only asset request');
  try {
    return await readOnce(target, { ...options, method });
  } catch (error) {
    // Retry only a reset before headers. Body failures, HTTP errors,
    // cancellation and persistent failures remain visible to the loader.
    if (options.signal?.aborted || !resetCodes.has(error.code ?? error.cause?.code)) throw error;
    options.signal?.throwIfAborted();
    return readOnce(target, { ...options, method });
  }
}
