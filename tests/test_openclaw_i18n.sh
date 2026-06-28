#!/bin/sh
# i18n 完整性检查: 确保中英双语语言包完整、菜单已英文化、po 可编译为 lmo。
set -eu

fail() { echo "FAIL: $1" >&2; exit 1; }

PO="po/zh_Hans/openclaw.po"
[ -f "$PO" ] || fail "中文语言包缺失: $PO"

if ! command -v python3 >/dev/null 2>&1; then
	echo "SKIP: python3 unavailable"
	exit 0
fi

python3 - <<'PY' || exit 1
import re, glob, sys, subprocess, struct, tempfile, os

# 中文/品牌技术名: 界面保留英文, 不要求翻译
WHITELIST = {'Bot Token', 'Bot ID %s', 'PID', 'Node.js'}

def die(m):
    print("FAIL: " + m, file=sys.stderr); sys.exit(1)

# 1) 解析 po 的 msgid 集合
def unq(s):
    s = s.strip()[1:-1]
    return s.replace('\\"', '"').replace('\\\\', '\\')
po_ids = set()
with open('po/zh_Hans/openclaw.po', encoding='utf-8') as f:
    for line in f:
        if line.startswith('msgid "') and line.strip() != 'msgid ""':
            po_ids.add(unq(line[6:]))

# 已退役的备份/恢复界面不得继续占用语言包；OpenClaw 自身的 Git 备份说明不在此列。
retired_backup_ids = {
    'Backup / Restore', 'Backup and restore', 'Create config backup',
    'Create full backup', 'Import backup', 'Restoring backup...',
    'Verifying backup...'
}
stale = retired_backup_ids & po_ids
if stale:
    die("语言包仍含已退役的备份/恢复文案:\n  " + "\n  ".join(sorted(stale)))

# 2) 提取前端 _() msgid
pat = re.compile(r"""(?<![\w$])_\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")""")
def unesc(l):
    q = l[0]; b = l[1:-1]; return b.replace('\\'+q, q).replace('\\\\', '\\')
js_ids = set()
for fp in glob.glob('htdocs/luci-static/resources/**/*.js', recursive=True):
    for m in pat.finditer(open(fp, encoding='utf-8').read()):
        js_ids.add(unesc(m.group(1)))

# 3) 漏译检查: 每个前端 msgid 必须有翻译或在白名单
missing = js_ids - po_ids - WHITELIST
if missing:
    die("以下前端文案缺少中文翻译:\n  " + "\n  ".join(sorted(repr(s) for s in missing)))

# 4) 残留中文检查: JS / 菜单不应再有硬编码中文
CJK = re.compile(r'[一-鿿]')
for fp in glob.glob('htdocs/luci-static/resources/**/*.js', recursive=True):
    for m in pat.finditer(open(fp, encoding='utf-8').read()):
        if CJK.search(unesc(m.group(1))):
            die("前端 _() 仍含硬编码中文: %s 于 %s" % (m.group(1), fp))
menu = open('root/usr/share/luci/menu.d/luci-app-openclaw.json', encoding='utf-8').read()
if CJK.search(re.sub(r'//.*', '', menu)):
    die("菜单标题仍含中文")

# 5) po 能编译为非空 lmo, 且可反查一条
out = tempfile.mktemp(suffix='.lmo')
r = subprocess.run(['python3', 'scripts/po2lmo.py', 'po/zh_Hans/openclaw.po', out])
if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
    die("po2lmo 编译失败或产物为空")
data = open(out, 'rb').read(); os.unlink(out)
sys.path.insert(0, 'scripts')
from po2lmo import sfh_hash
idx_total = struct.unpack('>I', data[-4:])[0]
idx = data[idx_total:-4]
def lookup(msgid):
    b = msgid.encode(); kid = sfh_hash(b, len(b))
    for i in range(len(idx) // 16):
        k, v, off, ln = struct.unpack('>IIII', idx[i*16:i*16+16])
        if k == kid:
            return data[off:off+ln].decode('utf-8')
    return None
if lookup('Operation failed') != '操作失败':
    die("lmo 反查校验失败 (Operation failed)")

print("i18n: %d 前端 msgid, %d po 条目, lmo 反查 OK" % (len(js_ids), len(po_ids)))
PY

echo ok
