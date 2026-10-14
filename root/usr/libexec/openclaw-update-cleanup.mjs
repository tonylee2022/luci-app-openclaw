// root 只清理已完成、无租约和无进程引用的官方更新投影；不接管升级恢复。
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

function signature(file) {
  const s = stat(file);
  return s ? `${s.dev}:${s.ino}:${s.ctimeNs}:${s.mtimeNs}:${s.size}` : null;
}

function identity(file) {
  const s = stat(file);
  return s ? `${s.dev}:${s.ino}` : null;
}

function safe(file, owner, directory, privateMode = true) {
  const s = stat(file);
  requireCondition(s && (directory ? s.isDirectory() : s.isFile()) && s.uid === owner &&
    (s.mode & (privateMode ? 0o077n : 0o022n)) === 0n &&
    (directory || s.nlink === 1n) && fs.realpathSync(file) === file,
  'Unsafe ownership, permissions or canonical path');
  return s;
}

function readDatabase(file, owner, readers) {
  safe(path.dirname(file), owner, true);
  safe(file, owner, false);
  for (const suffix of ['-wal', '-shm', '-journal', '.lock']) {
    requireCondition(!stat(file + suffix), 'SQLite sidecar or lock remains');
  }
  const before = signature(file);
  const db = new DatabaseSync(file, { readOnly: true });
  readers.push(db);
  db.exec('BEGIN');
  // WAL 的读事务不能阻止写者发布新 lease，无法为删除提供排他边界。
  requireCondition(db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal', 'WAL lease or receipt requires official maintenance');
  return { db, assertCurrent() {
    safe(file, owner, false);
    requireCondition(signature(file) === before, 'Receipt or lease database changed');
  } };
}

function packageParents(installKey) {
  const parts = installKey.split(path.sep);
  const modules = parts.indexOf('node_modules');
  const boundary = parts.slice(0, modules >= 0 ? modules + 1 : parts.length).join(path.sep);
  const result = [];
  let parent = path.dirname(installKey);
  while (true) {
    result.push(parent);
    if (parent !== boundary && !parent.startsWith(boundary + path.sep)) break;
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  return result;
}

function runtimeMarker(directory, installKey, owner) {
  safe(directory, owner, true);
  requireCondition(fs.readdirSync(directory).join(',') === 'tree', 'Unexpected files in runtime directory');
  safe(path.join(directory, 'tree'), owner, true);
  const base = path.parse(installKey).root;
  const marker = path.join(directory, 'tree', Buffer.from(base).toString('hex'),
    path.relative(base, installKey), 'package.json');
  const s = stat(marker);
  // 投影文件可与安装包共享 inode，不能要求单硬链接。
  requireCondition(s?.isFile() && s.uid === owner && fs.realpathSync(marker) === marker &&
    (s.mode & 0o022n) === 0n && s.size <= 1048576n, 'No safe official OpenClaw runtime marker');
  requireCondition(JSON.parse(fs.readFileSync(marker, 'utf8')).name === 'openclaw', 'Unknown runtime package');
}

// 只输出 PID、检查类型和错误码，进程参数、环境及打开文件内容不进入日志。
export function inspectRuntimeReferences(roots, procRoot = '/proc') {
  const references = [];
  let checkedProcesses = 0;
  const vanished = error => ['ENOENT', 'ESRCH'].includes(error.code);
  const record = (pid, type, value) => {
    for (const root of roots) if (value.includes(root)) references.push({ pid: Number(pid), type, path: root });
  };
  for (const pid of fs.readdirSync(procRoot).filter(name => /^\d+$/.test(name))) {
    const dir = path.join(procRoot, pid);
    try {
      const command = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8');
      // 无用户态命令行的内核线程或已退出进程不持有 Node 更新 worker。
      if (!command) continue;
      const before = fs.readFileSync(path.join(dir, 'stat'), 'utf8');
      checkedProcesses++;
      record(pid, 'cmdline', command);
      let cwd;
      for (const type of ['cwd', 'exe', 'root']) {
        const value = fs.readlinkSync(path.join(dir, type));
        if (type === 'cwd') cwd = value;
        record(pid, type, value);
      }
      // 解析通过软链接或相对路径启动的脚本，避免仅匹配命令行原文。
      for (const argument of command.split('\0').filter(Boolean)) {
        const value = argument.startsWith('--') && argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
        if (value.startsWith('-') || !value.includes('/')) continue;
        const file = path.resolve(cwd, value);
        try { record(pid, 'argument-path', fs.realpathSync(file)); }
        catch (error) { if (!vanished(error) && error.code !== 'ENOTDIR') throw error; }
      }
      record(pid, 'maps', fs.readFileSync(path.join(dir, 'maps'), 'utf8'));
      record(pid, 'environ', fs.readFileSync(path.join(dir, 'environ'), 'utf8'));
      for (const fd of fs.readdirSync(path.join(dir, 'fd'))) {
        try { record(pid, 'fd', fs.readlinkSync(path.join(dir, 'fd', fd))); }
        catch (error) { if (!vanished(error)) throw error; }
      }
      const after = fs.readFileSync(path.join(dir, 'stat'), 'utf8');
      const start = value => value.slice(value.lastIndexOf(')') + 2).split(' ')[19];
      requireCondition(start(before) === start(after), `PID ${pid} identity changed`);
    } catch (error) {
      // 仅整个进程已消失时允许跳过；仍存活但缺少检查数据时不能认定无占用。
      if (vanished(error) && !stat(dir)) continue;
      throw new Error(`Process inspection incomplete at PID ${pid}: ${error.code ?? 'identity-or-path'}`);
    }
  }
  return { checkedProcesses, references };
}

export function cleanupRuntimes(installKey, { temporaryDirectories = [], procRoot = '/proc', checkOnly = false } = {}) {
  const result = { status: 'ok', removed: [], retained: [], checkedProcesses: 0, checkOnly };
  const readers = [];
  const candidates = [];
  const retain = (file, reason) => { result.status = 'warning'; result.retained.push({ path: file, reason }); };
  try {
    requireCondition(path.resolve(installKey) === installKey, 'Package path must be absolute');
    const owner = stat(installKey)?.uid;
    safe(installKey, owner, true, false);
    const parents = new Set([...packageParents(installKey), '/tmp', ...temporaryDirectories]);
    for (const parent of parents) {
      try {
        requireCondition(path.resolve(parent) === parent && fs.realpathSync(parent) === parent, 'Unsafe runtime search parent');
        const entries = fs.readdirSync(parent);
        requireCondition(entries.length <= 4096, 'Runtime directory inventory exceeds bounded lookup');
        for (const name of entries.filter(name => /^openclaw-update-runtime-[A-Za-z0-9]{6}$/.test(name))) {
          const file = path.join(parent, name);
          try { runtimeMarker(file, installKey, owner); candidates.push({ file, before: signature(file) }); }
          catch (error) { retain(file, error.message); }
        }
      } catch (error) { if (error.code !== 'ENOENT') retain(parent, error.message); }
    }
    if (!candidates.length) return result;

    const parent = path.dirname(installKey);
    const key = createHash('sha256').update(installKey).digest('hex').slice(0, 24);
    const anchor = path.join(parent, `.openclaw.package-activation-${key}`);
    requireCondition(!stat(anchor) && !stat(`${anchor}.sqlite`) && !stat(`${anchor}.recovery.mjs`), 'Unfinished package activation remains');
    const control = `${anchor}.control`;
    safe(control, owner, true);
    requireCondition(fs.readdirSync(control).join(',') === 'operation.sqlite', 'Unknown or unfinished recovery artifacts');
    const receipt = readDatabase(path.join(control, 'operation.sqlite'), owner, readers);
    const rows = receipt.db.prepare('SELECT * FROM package_activation LIMIT 2').all();
    requireCondition(rows.length === 1 && rows[0].slot === 1 && rows[0].phase === 'anchor-retired', 'No known completed package receipt');
    const row = rows[0];
    requireCondition(Buffer.byteLength(row.descriptor_json) <= 1048576 && Buffer.byteLength(row.intent_json) <= 1048576, 'Oversized package receipt');
    const d = JSON.parse(row.descriptor_json), intent = JSON.parse(row.intent_json);
    requireCondition(d.version === 1 && d.layout === 'external-helper' && intent.kind === 'unlink-helper' &&
      intent.identity === d.helperIdentity && ['candidate', 'previous'].includes(intent.selected) &&
      d.authority?.installKey === installKey && d[intent.selected]?.identity === identity(installKey) &&
      d.parentIdentity === identity(parent) && d.journalParentIdentity === identity(control) &&
      d.journalIdentity === identity(path.join(control, 'operation.sqlite')), 'Completed receipt does not match installation');
    const leasePath = d.authority.databasePath;
    requireCondition(typeof leasePath === 'string' && path.resolve(leasePath) === leasePath &&
      path.basename(leasePath) === 'managed-update-handoffs.sqlite', 'Unknown update lease database');
    const lease = readDatabase(leasePath, owner, readers);
    // 共享读锁一直保留至删除结束，阻止当前 lease 数据库发布新的更新所有权。
    requireCondition(lease.db.prepare('SELECT COUNT(*) AS count FROM managed_update_handoffs').get().count === 0,
      'Unreleased update/Doctor/triage lease exists');
    for (const { file, before } of candidates) {
      try {
        const census = inspectRuntimeReferences([file], procRoot);
        result.checkedProcesses = Math.max(result.checkedProcesses, census.checkedProcesses);
        requireCondition(census.references.length === 0,
          `Runtime in use by PID(s): ${[...new Set(census.references.map(ref => ref.pid))].join(',')}`);
        receipt.assertCurrent();
        lease.assertCurrent();
        runtimeMarker(file, installKey, owner);
        requireCondition(signature(file) === before, 'Runtime directory identity changed');
        if (checkOnly) result.retained.push({ path: file, reason: 'Dry run: eligible for cleanup' });
        else {
          fs.rmSync(file, { recursive: true });
          result.removed.push(file);
        }
      } catch (error) { retain(file, error.message); }
    }
  } catch (error) {
    for (const { file } of candidates) if (!result.removed.includes(file) && !result.retained.some(item => item.path === file)) retain(file, error.message);
    if (!candidates.length) retain(installKey, error.message);
  } finally { for (const db of readers.reverse()) db.close(); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireCondition(process.getuid() === 0, 'Runtime cleanup requires root');
    const args = process.argv.slice(2);
    const checkOnly = args.at(-1) === '--check-only';
    if (checkOnly) args.pop();
    requireCondition(args.length >= 1 && args.length <= 2, 'Usage: cleanup <package-path> [temporary-directory] [--check-only]');
    console.log(JSON.stringify(cleanupRuntimes(args[0], { temporaryDirectories: args[1] ? [args[1]] : [], checkOnly })));
  } catch (error) {
    console.log(JSON.stringify({ status: 'warning', removed: [], retained: [], reason: error.message }));
    process.exitCode = 1;
  }
}
