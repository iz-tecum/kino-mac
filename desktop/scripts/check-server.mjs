import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { startGameServer } from './server.mjs';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'kino-server-check-'));
let server;
function raw(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${server.origin}/`, { path: pathname, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
try {
  await writeFile(path.join(fixture, 'index.html'), '<!doctype html><title>Test</title>');
  await writeFile(path.join(fixture, 'asset.bin'), '0123456789');
  await symlink('/etc/hosts', path.join(fixture, 'outside.txt'));
  server = await startGameServer(fixture);
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const index = await fetch(server.origin);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal((await fetch(`${server.origin}/asset.bin`, { method: 'HEAD' })).headers.get('content-length'), '10');
  const partial = await fetch(`${server.origin}/asset.bin`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345');
  const suffix = await fetch(`${server.origin}/asset.bin`, { headers: { Range: 'bytes=-3' } });
  assert.equal(await suffix.text(), '789');
  assert.equal((await fetch(`${server.origin}/asset.bin`, { headers: { Range: 'bytes=30-' } })).status, 416);
  assert.equal((await fetch(`${server.origin}/asset.bin`, { method: 'POST' })).status, 405);
  assert.equal((await raw('/outside.txt')).status, 403);
  assert.equal((await raw('/%2e%2e%2foutside.txt')).status, 403);
  assert.equal((await raw('/asset.bin', { Host: 'untrusted.example' })).status, 403);
  assert.equal((await raw('/asset.bin', { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await raw('/%ZZ')).status, 400);
  assert.equal((await fetch(`${server.origin}/missing.bin`)).status, 404);
  const origin = server.origin;
  await server.close(); server = null;
  await assert.rejects(fetch(origin));
  console.log('PASS: local assets, range requests, MIME/CSP, method/origin/host/path restrictions, and shutdown.');
} finally {
  if (server) await server.close();
  await rm(fixture, { recursive: true, force: true });
}
