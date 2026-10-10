import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchLocalAsset } from '../scripts/local-fetch.mjs';

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/kino.gltf`;
}

test('recovers a real reset before headers and preserves range and body bytes', async t => {
  let requests = 0;
  const url = await fixture(t, (req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.headers.range, 'bytes=3-8');
    if (++requests === 1) return req.socket.destroy();
    res.writeHead(206, { 'Content-Range': 'bytes 3-8/10', 'Content-Type': 'model/gltf+json' }).end('abcdef');
  });
  const response = await fetchLocalAsset(url, { headers: { range: 'bytes=3-8' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 3-8/10');
  assert.equal(await response.text(), 'abcdef'); assert.equal(requests, 2);
});

test('persistent reset is bounded to two requests', async t => {
  let requests = 0;
  const url = await fixture(t, req => { requests++; req.socket.destroy(); });
  await assert.rejects(fetchLocalAsset(url)); assert.equal(requests, 2);
});

test('does not retry an HTTP error or follow a redirect', async t => {
  let requests = 0;
  const url = await fixture(t, (_req, res) => { requests++; res.writeHead(404).end('missing'); });
  assert.equal((await fetchLocalAsset(url)).status, 404); assert.equal(requests, 1);
  const redirect = await fixture(t, (_req, res) => res.writeHead(302, { location: 'https://example.com/' }).end());
  await assert.rejects(fetchLocalAsset(redirect));
});

test('an aborted request is not replayed', async t => {
  const controller = new AbortController(); let requests = 0;
  const url = await fixture(t, () => { requests++; controller.abort(); });
  await assert.rejects(fetchLocalAsset(url, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('HEAD stays bodyless and unsafe targets or methods are rejected', async t => {
  let requests = 0;
  const url = await fixture(t, (req, res) => { requests++; assert.equal(req.method, 'HEAD'); res.writeHead(200).end(); });
  assert.equal(await (await fetchLocalAsset(url, { method: 'HEAD' })).text(), '');
  await assert.rejects(fetchLocalAsset(url, { method: 'POST' }));
  await assert.rejects(fetchLocalAsset('https://example.com/'));
  await assert.rejects(fetchLocalAsset('http://user@127.0.0.1/'));
  assert.equal(requests, 1);
});

test('asset burst has at most twelve active transfers until bodies finish', async t => {
  let active = 0, peak = 0, requests = 0;
  const url = await fixture(t, (_req, res) => {
    active++; requests++; peak = Math.max(peak, active);
    res.writeHead(200); res.write('first');
    setTimeout(() => { active--; res.end('last'); }, 20);
  });
  const bodies = await Promise.all(Array.from({ length: 80 }, async () =>
    (await fetchLocalAsset(url)).text()));
  assert.equal(requests, 80); assert(peak > 1 && peak <= 12, `peak transfers: ${peak}`);
  assert(bodies.every(body => body === 'firstlast'));
});

test('canceling a streaming body frees a slot without replaying it', async t => {
  let requests = 0;
  const url = await fixture(t, (_req, res) => { requests++; res.writeHead(200); res.write('stream'); });
  const response = await fetchLocalAsset(url);
  await response.body.cancel(); assert.equal(requests, 1);
});
