import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inspectReceipt } from '../root/usr/libexec/openclaw-update-receipt.mjs';

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

try {
  let f = fixture();
  const before = fs.readFileSync(f.journal);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath, checkOnly: true }), /stale/);
  assert.deepEqual(fs.readFileSync(f.journal), before);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /Archived/);
  assert.equal(fs.existsSync(f.control), false);
  const archived = fs.readdirSync(f.parent).find(n => n.startsWith('.openclaw-receipt-archive-'));
  assert.deepEqual(fs.readFileSync(path.join(f.parent, archived, 'operation.sqlite')), before);

  f = fixture(false);
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /current/);
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
  await refused(f, /database is absent/);

  // 回滚完成后选中的旧包，同样可以拥有合法的完成回执。
  f = fixture();
  f.d.previous.identity = id(f.install);
  f.d.candidate.identity = '1:99';
  f.d.preparation.find(v => v.name === 'candidate').identity = f.d.candidate.identity;
  f.intent.selected = 'previous';
  change(f, 'descriptor_json', JSON.stringify(f.d));
  change(f, 'intent_json', JSON.stringify(f.intent));
  assert.match(await inspectReceipt(f.install, { leasePath: f.leasePath }), /Archived/);

  // 即使记录数据库已消失，也要检查当前数据库的租约，而不是改写身份。
  f = fixture();
  const oldLeasePath = f.leasePath;
  const newLeasePath = path.join(f.parent, 'managed-update-handoffs.sqlite');
  fs.renameSync(oldLeasePath, newLeasePath);
  assert.match(await inspectReceipt(f.install, { leasePath: newLeasePath }), /Archived/);

  // 使用真实动态导出解析覆盖生产入口，避免只验证测试注入路径。
  f = fixture();
  fs.mkdirSync(path.join(f.install, 'dist'), { mode: 0o700 });
  fs.writeFileSync(path.join(f.install, 'dist', 'tmp-openclaw-dir-test.mjs'),
    `function resolvePreferredOpenClawTmpDir(){return ${JSON.stringify(path.dirname(f.leasePath))};}\nexport {resolvePreferredOpenClawTmpDir as n};\n`);
  assert.match(await inspectReceipt(f.install), /Archived/);
  const active = new DatabaseSync(f.leasePath);
  active.prepare('INSERT INTO managed_update_handoffs VALUES (?,?,?,?)').run(f.install, 'owner', '{}', 1);
  active.close();
  await assert.rejects(inspectReceipt(f.install, { checkOnly: true }), /Unreleased/);
  console.log('ok: receipt archival and refusal cases');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
