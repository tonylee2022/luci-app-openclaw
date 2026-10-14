// 只读检查已核验的完成回执；新租约与历史归档由官方更新器取得所有权后处理。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

function requireCondition(ok, message) {
  if (!ok) throw new Error(message);
}

function stat(file) {
  try { return fs.lstatSync(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function identity(file) {
  const value = stat(file);
  return value ? `${value.dev}:${value.ino}` : null;
}

function safe(file, directory, privateMode = true) {
  const value = stat(file);
  requireCondition(value && (directory ? value.isDirectory() : value.isFile()) &&
    value.uid === BigInt(process.getuid()) && value.ino !== 0n &&
    (privateMode ? (value.mode & 0o077n) === 0n : (value.mode & 0o022n) === 0n) &&
    (directory || value.nlink === 1n) &&
    fs.realpathSync(file) === file, 'Unsafe ownership, permissions or path; preserve recovery artifacts');
  return value;
}

function signature(file) {
  const s = stat(file);
  return s ? `${s.dev}:${s.ino}:${s.ctimeNs}:${s.mtimeNs}:${s.size}` : null;
}

function openReadTransaction(file) {
  safe(path.dirname(file), true);
  safe(file, false);
  for (const suffix of ['-journal', '-wal', '-shm', '.lock']) {
    requireCondition(!stat(file + suffix), 'SQLite sidecar or lock exists; use official recovery first');
  }
  const before = signature(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('BEGIN');
    return { db, assertUnchanged() {
      requireCondition(signature(file) === before, 'Recovery database changed during inspection');
      safe(file, false);
    } };
  } catch (error) { db.close(); throw error; }
}

async function currentLeasePath(installKey) {
  // 上游模块名含内容哈希，按函数的导出名称识别；不编辑上游 dist。
  const dist = path.join(installKey, 'dist');
  const names = fs.readdirSync(dist).filter(name => /^tmp-openclaw-dir-[\w-]+\.mjs$/.test(name));
  requireCondition(names.length === 1, 'Unknown upstream temp-root runtime; manual inspection required');
  const file = path.join(dist, names[0]);
  const source = fs.readFileSync(file, 'utf8');
  const exported = source.match(/export\s*\{[^}]*\bresolvePreferredOpenClawTmpDir\s+as\s+(\w+)/);
  requireCondition(exported, 'Unknown upstream temp-root export; manual inspection required');
  const runtime = await import(pathToFileURL(file).href);
  return path.join(runtime[exported[1]](), 'managed-update-handoffs.sqlite');
}

function parseBounded(value) {
  requireCondition(typeof value === 'string' && Buffer.byteLength(value) <= 1048576,
    'Invalid or oversized package receipt');
  return JSON.parse(value);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function validIdentity(value) {
  return typeof value === 'string' && /^\d+:\d+$/.test(value);
}

function absolute(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && path.resolve(value) === value;
}

function fingerprint(value) {
  return exactKeys(value, ['digest', 'identity', 'version']) && validIdentity(value.identity) &&
    typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest) &&
    typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 256;
}

function assertKnownDescriptor(d) {
  requireCondition(exactKeys(d, ['layout', 'version', 'operationId', 'recoveryNodePath', 'authority',
    'anchorIdentity', 'journalIdentity', 'journalParentIdentity', 'parentIdentity', 'binDir', 'binIdentity',
    'originalStageRoot', 'previous', 'candidate', 'launcherRootIdentity', 'previousLauncherRootIdentity',
    'helperIdentity', 'preparation', 'helperDigest', 'launchers']) &&
    ['anchorIdentity', 'journalIdentity', 'journalParentIdentity', 'parentIdentity', 'binIdentity',
      'launcherRootIdentity', 'helperIdentity'].every(key => validIdentity(d[key])) &&
    (d.previousLauncherRootIdentity === null || validIdentity(d.previousLauncherRootIdentity)) &&
    ['recoveryNodePath', 'binDir', 'originalStageRoot'].every(key => absolute(d[key])) &&
    fingerprint(d.previous) && fingerprint(d.candidate) &&
    typeof d.helperDigest === 'string' && /^[a-f0-9]{64}$/.test(d.helperDigest) &&
    exactKeys(d.authority, ['databasePath', 'databaseIdentity', 'parentIdentity', 'installKey', 'owner']) &&
    typeof d.authority.owner === 'string' && d.authority.owner.length > 0 && d.authority.owner.length <= 4096,
  'Unknown or invalid package receipt descriptor; manual inspection required');
}

function assertEmptyLease(file, readers) {
  const reader = openReadTransaction(file);
  readers.push(reader);
  const count = reader.db.prepare('SELECT COUNT(*) AS count FROM managed_update_handoffs').get().count;
  requireCondition(count === 0, 'Unreleased update/Doctor/triage lease exists; preserve receipt and use official recovery');
}

export async function inspectReceipt(installKey, { checkOnly = false, leasePath } = {}) {
  requireCondition(path.resolve(installKey) === installKey, 'Package path must be absolute');
  const parent = path.dirname(installKey);
  const key = createHash('sha256').update(installKey).digest('hex').slice(0, 24);
  const anchor = path.join(parent, `.openclaw.package-activation-${key}`);
  const control = `${anchor}.control`;
  // 即使外置 control 不存在，也不能忽略旧布局或未完成的 anchor。
  for (const file of [anchor, `${anchor}.sqlite`, `${anchor}.recovery.mjs`]) {
    requireCondition(!stat(file), 'Pending or legacy package activation exists; use its original recovery owner');
  }
  if (!stat(control)) {
    // 某些失败发生在生成安装回执之前，仍须检查已发布的升级租约。
    const dist = path.join(installKey, 'dist');
    if (stat(dist) && fs.readdirSync(dist).some(name => /^tmp-openclaw-dir-[\w-]+\.mjs$/.test(name))) {
      const current = leasePath ?? await currentLeasePath(installKey);
      if (stat(current)) {
        const readers = [];
        try {
          assertEmptyLease(current, readers);
          readers.forEach(reader => reader.assertUnchanged());
        } finally { readers.forEach(reader => reader.db.close()); }
      }
    }
    return 'No retained package receipt';
  }
  safe(parent, true, false);
  safe(installKey, true, false);
  safe(control, true);
  requireCondition(fs.readdirSync(control).length === 1 && fs.readdirSync(control)[0] === 'operation.sqlite',
    'Recovery helper or unknown artifacts remain; do not archive this operation');
  const journal = path.join(control, 'operation.sqlite');
  const readers = [];
  try {
    const receiptReader = openReadTransaction(journal);
    readers.push(receiptReader);
    const rows = receiptReader.db.prepare('SELECT * FROM package_activation LIMIT 2').all();
    requireCondition(rows.length === 1 && rows[0].slot === 1 &&
      Number.isSafeInteger(rows[0].revision) && rows[0].revision >= 0, 'Invalid package receipt row');
    const row = rows[0];
    const d = parseBounded(row.descriptor_json);
    assertKnownDescriptor(d);
    const intent = parseBounded(row.intent_json);
    const publications = parseBounded(row.publications_json);
    requireCondition(d.version === 1 && d.layout === 'external-helper' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(d.operationId) && row.phase === 'anchor-retired' &&
      exactKeys(intent, ['kind', 'identity', 'selected']) &&
      intent?.kind === 'unlink-helper' && intent.identity === d.helperIdentity &&
      ['candidate', 'previous'].includes(intent.selected), 'Receipt is not a known completed operation');
    const a = d.authority;
    requireCondition(a?.installKey === installKey && typeof a.databasePath === 'string' &&
      path.resolve(a.databasePath) === a.databasePath && path.basename(a.databasePath) === 'managed-update-handoffs.sqlite' &&
      /^\d+:\d+$/.test(a.databaseIdentity) && /^\d+:\d+$/.test(a.parentIdentity), 'Invalid receipt authority');
    requireCondition(d.parentIdentity === identity(parent) && d.journalParentIdentity === identity(control) &&
      d.journalIdentity === identity(journal) && d[intent.selected]?.identity === identity(installKey),
    'Receipt does not match the selected package or installation directories');
    const expected = new Map([
      ['anchor', d.anchorIdentity], ['helper', d.helperIdentity],
      ['candidate', d.candidate?.identity], ['launchers', d.launcherRootIdentity],
      ...(d.previousLauncherRootIdentity ? [['previous-launchers', d.previousLauncherRootIdentity]] : []),
    ]);
    requireCondition(Array.isArray(d.preparation) && d.preparation.length === expected.size &&
      new Set(d.preparation.map(v => v.name)).size === expected.size &&
      d.preparation.every(v => exactKeys(v, ['name', 'source', 'sourceParentIdentity', 'identity']) &&
        expected.get(v.name) === v.identity && validIdentity(v.identity) && validIdentity(v.sourceParentIdentity) && absolute(v.source)) &&
      d.preparation.find(v => v.name === 'candidate')?.source === d.originalStageRoot &&
      // 官方先在 staging 发布 helper，再移入 control；历史来源保留 staging 路径。
      [path.join(control, 'recovery.mjs'),
        `${d.preparation.find(v => v.name === 'anchor')?.source}.recovery.mjs`]
        .includes(d.preparation.find(v => v.name === 'helper')?.source) &&
      Array.isArray(d.launchers) && d.launchers.length <= 64 &&
      new Set(d.launchers.map(v => v.name)).size === d.launchers.length &&
      d.launchers.every(v => exactKeys(v, ['name', 'previous', 'candidate', 'previousIdentity', 'candidateIdentity']) &&
        typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 255 &&
        v.name !== '.' && v.name !== '..' && !/[\\/\0]/.test(v.name) &&
        (v.previous === null || typeof v.previous === 'string' && v.previous.length <= 4096) &&
        typeof v.candidate === 'string' && v.candidate.length <= 4096 &&
        (v.previousIdentity === null || validIdentity(v.previousIdentity)) && validIdentity(v.candidateIdentity)) &&
      Array.isArray(publications) && publications.length <= 64 &&
      new Set(publications.map(v => v.name)).size === publications.length &&
      publications.every(v => exactKeys(v, ['name', 'identity']) && validIdentity(v.identity) &&
        d.launchers.some(l => l.name === v.name)), 'Invalid completed receipt custody');

    const current = leasePath ?? await currentLeasePath(installKey);
    // 完成回执只是历史证据，临时 lease 数据库缺失不能重新打开已完成操作。
    // 现存数据库仍检查并发所有权；不创建数据库、不改写身份、不自行归档。
    for (const file of new Set([current, a.databasePath])) {
      if (!stat(file)) continue;
      assertEmptyLease(file, readers);
    }
    for (const reader of readers) reader.assertUnchanged();
    return 'Completed package receipt; official updater owns lease admission and archival';
  } finally {
    for (const reader of readers.reverse()) reader.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireCondition(process.argv.length >= 3 && process.argv.length <= 4 &&
      (!process.argv[3] || process.argv[3] === '--check-only'), 'Usage: receipt <package-path> [--check-only]');
    console.log(await inspectReceipt(process.argv[2], { checkOnly: process.argv[3] === '--check-only' }));
  } catch (error) {
    console.error(`Update receipt preflight refused: ${error.message}`);
    process.exitCode = 1;
  }
}
