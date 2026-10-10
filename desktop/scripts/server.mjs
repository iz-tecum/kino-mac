import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'", "base-uri 'none'", "frame-src 'none'",
  "frame-ancestors 'none'", "form-action 'none'",
].join('; ');

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function startGameServer(directory) {
  const root = await realpath(directory);
  if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('Missing game index');
  let origin;
  const server = createServer(async (request, response) => {
    const reply = (status, body = '') => response.writeHead(status).end(body);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-cache');
    if (request.headers.host !== new URL(origin).host) return reply(403);
    if (request.headers.origin && request.headers.origin !== origin) return reply(403);
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return reply(405);
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return reply(400);
    } catch { return reply(400); }
    if (pathname === '/favicon.ico') return reply(204);
    if (pathname === '/__health') {
      response.setHeader('Content-Type', 'application/json');
      return reply(200, request.method === 'HEAD' ? '' : '{"app":"kino-desktop","ready":true}');
    }
    const requested = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!inside(root, requested)) return reply(403);
    let file, info;
    try {
      file = await realpath(requested);
      if (!inside(root, file)) return reply(403);
      info = await stat(file);
      if (!info.isFile()) return reply(404);
    } catch { return reply(404); }
    response.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    let start = 0, end = info.size - 1, statusCode = 200;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, info.size - Number(range[2])) : NaN;
      end = range?.[1] && range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        response.setHeader('Content-Range', `bytes */${info.size}`);
        return reply(416);
      }
      statusCode = 206;
      response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    response.setHeader('Content-Length', Math.max(0, end - start + 1));
    response.writeHead(statusCode);
    if (request.method === 'HEAD' || info.size === 0) return response.end();
    const stream = createReadStream(file, { start, end });
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return {
    origin,
    close: () => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
