#!/usr/bin/env node
// Merge new, identically staged Kino apps without modifying either input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeUniversalApp } from '@electron/universal';

const exec = promisify(execFile);
const option = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const required = key => { const value = option(key); assert(value && !value.startsWith('--'), `Required: ${key}`); return path.resolve(value); };
const x64 = await fs.realpath(required('--x64'));
const arm64 = await fs.realpath(required('--arm64'));
const output = required('--output');
const reportPath = option('--report') ? path.resolve(option('--report')) : `${output}.universal.json`;
assert(x64 !== arm64 && output !== x64 && output !== arm64, 'Inputs and output must be distinct');
assert(output.endsWith('.app'), 'Output must end in .app');
for (const p of [output, reportPath]) assert(!(await fs.access(p).then(() => true).catch(() => false)), `Refusing existing output: ${p}`);

async function files(root, relative = '') {
  if (!relative) root = await fs.realpath(root);
  const list = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) list.push(...await files(root, rel));
    else if (entry.isFile()) list.push(rel);
    // Framework symlinks point to files already visited in Versions/A.
    else if (entry.isSymbolicLink()) {
      const resolved = await fs.realpath(path.join(root, rel));
      assert(resolved.startsWith(root + path.sep), `External bundle symlink: ${rel}`);
    }
  }
  return list.sort();
}
async function digest(file) { return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); }
async function tree(root) {
  const result = {};
  for (const file of await files(root)) result[file] = await digest(path.join(root, file));
  return result;
}
async function nativeInventory(root) {
  const result = [];
  for (const file of await files(root)) {
    const full = path.join(root, file), handle = await fs.open(full, 'r');
    const header = Buffer.alloc(8); const { bytesRead } = await handle.read(header, 0, 8, 0); await handle.close();
    if (bytesRead < 4 || ![0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(header.readUInt32BE())) continue;
    const { stdout } = await exec('/usr/bin/lipo', ['-archs', full]);
    const build = await exec('/usr/bin/xcrun', ['vtool', '-show-build', full]);
    result.push({ file, architectures: stdout.trim().split(/\s+/).sort(),
      minimumMacOS: [...build.stdout.matchAll(/minos\s+(\S+)/g)].map(m => m[1]), sha256: await digest(full) });
  }
  return result;
}
async function removeSignatures(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(root, entry.name);
    if (entry.name === '_CodeSignature') await fs.rm(p, { recursive: true });
    else await removeSignatures(p);
  }
}
const appRelative = 'Contents/Resources/app';
const sourceTree = await tree(path.join(x64, appRelative));
assert.deepEqual(await tree(path.join(arm64, appRelative)), sourceTree, 'The two staged application payloads differ');
const sources = {};
for (const [arch, root] of [['x64', x64], ['arm64', arm64]]) {
  const provenance = JSON.parse(await fs.readFile(path.join(root, 'Contents/Resources/runtime-provenance.json'), 'utf8'));
  assert.equal(provenance.architecture, `darwin-${arch}`);
  const binaries = await nativeInventory(root);
  assert(binaries.length > 0, 'No native runtime binaries found');
  assert(binaries.every(item => item.architectures.length === 1 && item.architectures[0] === (arch === 'x64' ? 'x86_64' : arch)), `Incorrect ${arch} input slices`);
  sources[arch] = { app: root, provenance, binaries };
}
assert.equal(sources.x64.provenance.version, sources.arm64.provenance.version, 'Electron versions differ');
assert.deepEqual(sources.x64.binaries.map(b=>b.file), sources.arm64.binaries.map(b=>b.file), 'Native runtime file layouts differ');
const combined = { version: sources.arm64.provenance.version, architecture: 'darwin-universal',
  runtimes: { x64: sources.x64.provenance, arm64: sources.arm64.provenance },
  merger: { package: '@electron/universal', version: '3.0.6', gameFilesIdentical: true } };
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'kino-universal-inputs-'));
try {
  for (const [arch, source] of [['x64', x64], ['arm64', arm64]]) {
    const copy = path.join(temporary, `${arch}.app`);
    await exec('/usr/bin/ditto', ['--norsrc', '--noextattr', source, copy]);
    await removeSignatures(copy);
    await fs.writeFile(path.join(copy, 'Contents/Resources/runtime-provenance.json'), JSON.stringify(combined, null, 2) + '\n');
  }
  await makeUniversalApp({ x64AppPath: path.join(temporary, 'x64.app'), arm64AppPath: path.join(temporary, 'arm64.app'), outAppPath: output });
  const mergedTree = await tree(path.join(output, appRelative));
  assert.deepEqual(mergedTree, sourceTree, 'Merged app changed an application payload file');
  const binaries = await nativeInventory(output);
  assert.deepEqual(binaries.map(b=>b.file), sources.arm64.binaries.map(b=>b.file));
  assert(binaries.every(b => JSON.stringify(b.architectures) === '["arm64","x86_64"]'), 'Every native file must contain both slices');
  assert(binaries.every(b => b.minimumMacOS.length === 2 && b.minimumMacOS.every(version => version === '13.0')), 'Unexpected native deployment minimum');
  const snapshotRelative = 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources';
  const snapshots = [];
  for (const [arch, root] of [['x64', x64], ['arm64', arm64]]) {
    for (const name of await files(path.join(root, snapshotRelative))) {
      if (!name.endsWith('.bin')) continue;
      const file = path.join(snapshotRelative, name), sourceHash = await digest(path.join(root, file));
      assert.equal(await digest(path.join(output, file)), sourceHash, `Runtime snapshot changed: ${file}`);
      snapshots.push({ architecture: arch, file, sha256: sourceHash });
    }
  }
  const report = { createdAt: new Date().toISOString(), output, status: 'merged; MUST re-sign before distribution',
    package: combined, sources, nativeFiles: binaries, snapshots, gameFiles: Object.keys(sourceTree).length,
    applicationTreeSha256: crypto.createHash('sha256').update(JSON.stringify(sourceTree)).digest('hex'),
    applicationFiles: sourceTree, nativeExecutionTested: false, userMacBookTested: false };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, report: reportPath, nativeFiles: binaries.length, gameFiles: report.gameFiles,
    architectures: ['arm64', 'x86_64'], minimumMacOS: '13.0', requiresSigning: true }));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
