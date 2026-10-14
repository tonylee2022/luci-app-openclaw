import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inspectReceipt } from '../root/usr/libexec/openclaw-update-receipt.mjs';
import { cleanupRuntimes } from '../root/usr/libexec/openclaw-update-cleanup.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-receipt-test-'));
const id = file => { const s = fs.statSync(file, { bigint: true }); return `${s.dev}:${s.ino}`; };
function fixture(stale = true) {
  const parent = fs.mkdtempSync(path.join(root, 'case-'));
  const install = path.join(parent, 'openclaw');
  fs.mkdirSync(install, { mode: 0o700 });
  const key = createHash('sha256').update(install).digest('hex').slice(0, 24);
  const anchor = path.join(parent, `.openclaw.package-activation-${key}`);
  const control = `${anchor}.control`;
  fs.mkdirSync(control, { mode: 0o700 });
  const leases = path.join(parent, 'leases');
  fs.mkdirSync(leases, { mode: 0o700 });
  const leasePath = path.join(leases, 'managed-update-handoffs.sqlite');
  let db = new DatabaseSync(leasePath);
  db.exec('CREATE TABLE managed_update_handoffs (install_root TEXT PRIMARY KEY, owner TEXT, payload_json TEXT, updated_at INTEGER)');
  db.close();
  fs.chmodSync(leasePath, 0o600);
  const journal = path.join(control, 'operation.sqlite');
  db = new DatabaseSync(journal);
  db.exec('CREATE TABLE package_activation (slot INTEGER PRIMARY KEY, revision INTEGER, phase TEXT, descriptor_json TEXT, intent_json TEXT, publications_json TEXT)');
  fs.chmodSync(journal, 0o600);
  const digest = 'a'.repeat(64);
  const d = {
    version: 1, layout: 'external-helper', operationId: randomUUID(), recoveryNodePath: process.execPath,
    authority: { installKey: install, databasePath: leasePath, databaseIdentity: stale ? '0:1' : id(leasePath),
      parentIdentity: id(leases), owner: randomUUID() },
    anchorIdentity: '1:1', journalIdentity: id(journal), journalParentIdentity: id(control), parentIdentity: id(parent),
    binDir: parent, binIdentity: id(parent), originalStageRoot: path.join(parent, 'stage'),
    previous: { identity: '1:3', version: '2026.9.4', digest },
    candidate: { identity: id(install), version: '2026.9.9', digest },
    launcherRootIdentity: '1:4', previousLauncherRootIdentity: null, helperIdentity: '1:2', helperDigest: digest,
    preparation: [], launchers: [],
  };
  d.preparation = [
    { name: 'anchor', source: path.join(parent, 'staged-anchor'), identity: d.anchorIdentity, sourceParentIdentity: id(parent) },
    { name: 'helper', source: path.join(control, 'recovery.mjs'), identity: d.helperIdentity, sourceParentIdentity: id(control) },
    { name: 'candidate', source: d.originalStageRoot, identity: d.candidate.identity, sourceParentIdentity: id(parent) },
    { name: 'launchers', source: path.join(parent, 'staged-bin'), identity: d.launcherRootIdentity, sourceParentIdentity: id(parent) },
  ];
  const intent = { kind: 'unlink-helper', identity: d.helperIdentity, selected: 'candidate' };
  db.prepare('INSERT INTO package_activation VALUES (1,21,?,?,?,?)').run('anchor-retired', JSON.stringify(d), JSON.stringify(intent), '[]');
  db.close();
  const f = { parent, install, anchor, control, journal, leasePath, d, intent };
  return f;
}
function change(f, column, value) {
  const db = new DatabaseSync(f.journal);
  db.prepare(`UPDATE package_activation SET ${column}=?`).run(value);
  db.close();
}
async function refused(f, pattern) {
  const before = fs.readFileSync(f.journal);
  await assert.rejects(inspectReceipt(f.install, { leasePath: f.leasePath }), pattern);
  assert.deepEqual(fs.readFileSync(f.journal), before, 'refused receipt must remain byte-for-byte intact');
  assert.equal(fs.readdirSync(f.parent).some(n => n.startsWith('.openclaw-receipt-archive-')), false);
}

function cleanupFixture() {
  const f = fixture(false);
  f.runtime = path.join(f.parent, 'openclaw-update-runtime-Abc123');
  const marker = path.join(f.runtime, 'tree', Buffer.from(path.parse(f.install).root).toString('hex'),
    path.relative(path.parse(f.install).root, f.install), 'package.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
  fs.writeFileSync(marker, JSON.stringify({ name: 'openclaw', version: '2026.10.3' }), { mode: 0o600 });
  f.marker = marker;
  f.procRoot = path.join(f.parent, 'proc');
  const processDir = path.join(f.procRoot, '1');
  fs.mkdirSync(path.join(processDir, 'fd'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(processDir, 'cmdline'), '/sbin/procd\0');
  fs.writeFileSync(path.join(processDir, 'stat'), '1 (procd) S ' + Array(25).fill('1').join(' '));
  fs.writeFileSync(path.join(processDir, 'maps'), '');
  fs.writeFileSync(path.join(processDir, 'environ'), '');
  for (const name of ['cwd', 'exe', 'root']) fs.symlinkSync('/', path.join(processDir, name));
  return f;
}
function clean(f, checkOnly = false) {
  return cleanupRuntimes(f.install, { procRoot: f.procRoot, checkOnly });
}

try {
  let f = fixture();
  const before = fs.readFileSync(f.journal);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath, checkOnly: true }), /official updater/);
  assert.deepEqual(fs.readFileSync(f.journal), before);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /official updater/);
  assert.deepEqual(fs.readFileSync(f.journal), before);
  assert.equal(fs.existsSync(f.control), true);

  // 真实升级保留移动前的 staging helper 来源，而不是当前 control 路径。
  f = fixture();
  f.d.preparation.find(v => v.name === 'helper').source =
    f.d.preparation.find(v => v.name === 'anchor').source + '.recovery.mjs';
  change(f, 'descriptor_json', JSON.stringify(f.d));
  const stagedBefore = fs.readFileSync(f.journal);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath, checkOnly: true }), /official updater/);
  assert.deepEqual(fs.readFileSync(f.journal), stagedBefore);
  f.d.preparation.find(v => v.name === 'helper').source = path.join(f.parent, 'unrelated-helper.mjs');
  change(f, 'descriptor_json', JSON.stringify(f.d));
  await refused(f, /Invalid completed receipt custody/);

  f = fixture(false);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /official updater/);
  assert.equal(fs.existsSync(f.control), true);

  f = fixture();
  change(f, 'phase', 'publishing');
  await refused(f, /not a known completed/);
  f = fixture();
  fs.writeFileSync(path.join(f.control, 'recovery.mjs'), 'preserve', { mode: 0o600 });
  await refused(f, /artifacts remain/);
  f = fixture();
  fs.mkdirSync(f.anchor, { mode: 0o700 });
  await refused(f, /Pending or legacy/);
  f = fixture();
  fs.writeFileSync(f.journal + '-journal', 'hot', { mode: 0o600 });
  await refused(f, /artifacts remain/);
  f = fixture();
  fs.chmodSync(f.journal, 0o644);
  await refused(f, /Unsafe/);
  f = fixture();
  fs.renameSync(f.journal, f.journal + '.original');
  fs.symlinkSync(f.journal + '.original', f.journal);
  await refused(f, /artifacts remain/);
  f = fixture();
  f.d.version = 2;
  change(f, 'descriptor_json', JSON.stringify(f.d));
  await refused(f, /not a known completed/);
  f = fixture();
  f.d.unknownAuthority = true;
  change(f, 'descriptor_json', JSON.stringify(f.d));
  await refused(f, /Unknown or invalid/);
  f = fixture();
  f.d.candidate.identity = '0:9';
  change(f, 'descriptor_json', JSON.stringify(f.d));
  await refused(f, /does not match/);
  f = fixture();
  f.intent.identity = '0:9';
  change(f, 'intent_json', JSON.stringify(f.intent));
  await refused(f, /not a known completed/);
  f = fixture();
  const lease = new DatabaseSync(f.leasePath);
  lease.prepare('INSERT INTO managed_update_handoffs VALUES (?,?,?,?)').run(f.install, 'owner', '{}', 1);
  lease.close();
  await refused(f, /Unreleased/);
  f = fixture();
  fs.unlinkSync(f.leasePath);
  const missingBefore = fs.readFileSync(f.journal);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /official updater/);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath, checkOnly: true }), /official updater/);
  assert.equal(fs.existsSync(f.leasePath), false, 'LuCI must not invent a lease database');
  assert.deepEqual(fs.readFileSync(f.journal), missingBefore);
  assert.equal(fs.existsSync(f.control), true);

  // 回滚完成后选中的旧包，同样可以拥有合法的完成回执。
  f = fixture();
  f.d.previous.identity = id(f.install);
  f.d.candidate.identity = '1:99';
  f.d.preparation.find(v => v.name === 'candidate').identity = f.d.candidate.identity;
  f.intent.selected = 'previous';
  change(f, 'descriptor_json', JSON.stringify(f.d));
  change(f, 'intent_json', JSON.stringify(f.intent));
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /official updater/);

  // 即使记录数据库已消失，也要检查当前数据库的租约，而不是改写身份。
  f = fixture();
  const oldLeasePath = f.leasePath;
  const newLeasePath = path.join(f.parent, 'managed-update-handoffs.sqlite');
  fs.renameSync(oldLeasePath, newLeasePath);
  assert.match(await inspectReceipt(f.install, { leasePath: newLeasePath }), /official updater/);

  // 使用真实动态导出解析覆盖生产入口，避免只验证测试注入路径。
  f = fixture();
  fs.mkdirSync(path.join(f.install, 'dist'), { mode: 0o700 });
  fs.writeFileSync(path.join(f.install, 'dist', 'tmp-openclaw-dir-test.mjs'),
    `function resolvePreferredOpenClawTmpDir(){return ${JSON.stringify(path.dirname(f.leasePath))};}\nexport {resolvePreferredOpenClawTmpDir as n};\n`);
  assert.match(await inspectReceipt(f.install), /official updater/);
  const active = new DatabaseSync(f.leasePath);
  active.prepare('INSERT INTO managed_update_handoffs VALUES (?,?,?,?)').run(f.install, 'owner', '{}', 1);
  active.close();
  await assert.rejects(inspectReceipt(f.install, { checkOnly: true }), /Unreleased/);
  console.log('ok: read-only receipt delegation and refusal cases');

  // 删除只影响官方投影，回执和 lease 数据库的字节必须保留。
  f = cleanupFixture();
  const receiptBefore = fs.readFileSync(f.journal), leaseBefore = fs.readFileSync(f.leasePath);
  let result = clean(f, true);
  assert.equal(result.removed.length, 0);
  assert.equal(fs.existsSync(f.runtime), true);
  result = clean(f);
  assert.deepEqual(result.removed, [f.runtime]);
  assert.equal(fs.existsSync(f.runtime), false);
  assert.deepEqual(fs.readFileSync(f.journal), receiptBefore);
  assert.deepEqual(fs.readFileSync(f.leasePath), leaseBefore);

  // 空目录结果可被正常展示，无需依赖已经删除的旧 lease。
  result = clean(f);
  assert.equal(result.removed.length, 0);

  for (const kind of ['cmdline', 'maps', 'environ', 'fd', 'cwd', 'alias']) {
    f = cleanupFixture();
    const dir = path.join(f.procRoot, '1');
    if (['cmdline', 'maps', 'environ'].includes(kind)) fs.writeFileSync(path.join(dir, kind), f.runtime);
    else if (kind === 'fd') fs.symlinkSync(f.marker, path.join(dir, 'fd', '4'));
    else if (kind === 'cwd') { fs.unlinkSync(path.join(dir, 'cwd')); fs.symlinkSync(f.runtime, path.join(dir, 'cwd')); }
    else {
      const alias = path.join(f.parent, 'script-alias');
      fs.symlinkSync(f.marker, alias);
      fs.writeFileSync(path.join(dir, 'cmdline'), 'node\0' + alias + '\0');
    }
    result = clean(f);
    assert.equal(result.removed.length, 0, kind);
    assert.match(result.retained.find(v => v.path === f.runtime).reason, /Runtime in use/, kind);
    assert.equal(fs.existsSync(f.runtime), true);
  }

  f = cleanupFixture();
  fs.unlinkSync(path.join(f.procRoot, '1', 'cwd'));
  result = clean(f);
  assert.match(result.retained.find(v => v.path === f.runtime).reason, /inspection incomplete/);
  assert.equal(fs.existsSync(f.runtime), true);

  f = cleanupFixture();
  const activeLease = new DatabaseSync(f.leasePath);
  activeLease.prepare('INSERT INTO managed_update_handoffs VALUES (?,?,?,?)').run(f.install, 'owner', '{}', 1);
  activeLease.close();
  assert.match(clean(f).retained.find(v => v.path === f.runtime).reason, /Unreleased/);
  assert.equal(fs.existsSync(f.runtime), true);

  f = cleanupFixture();
  change(f, 'phase', 'publishing');
  assert.match(clean(f).retained.find(v => v.path === f.runtime).reason, /completed package receipt/);
  assert.equal(fs.existsSync(f.runtime), true);

  for (const kind of ['extra', 'permissions', 'marker', 'symlink', 'missing-lease', 'wal']) {
    f = cleanupFixture();
    if (kind === 'extra') fs.writeFileSync(path.join(f.runtime, 'recovery.sqlite'), 'preserve');
    else if (kind === 'permissions') fs.chmodSync(f.runtime, 0o777);
    else if (kind === 'marker') fs.writeFileSync(f.marker, JSON.stringify({ name: 'unrelated' }));
    else if (kind === 'symlink') {
      const actual = f.runtime + '.original';
      fs.renameSync(f.runtime, actual);
      fs.symlinkSync(actual, f.runtime);
    } else if (kind === 'missing-lease') fs.unlinkSync(f.leasePath);
    else { const db = new DatabaseSync(f.leasePath); db.exec('PRAGMA journal_mode=WAL'); db.close(); }
    result = clean(f);
    assert.equal(result.removed.length, 0, kind);
    assert.equal(fs.existsSync(f.runtime), true, kind);
    assert.equal(result.status, 'warning', kind);
  }
  console.log('ok: runtime cleanup, custody refusals and structured results');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
