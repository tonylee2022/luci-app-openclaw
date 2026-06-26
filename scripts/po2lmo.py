#!/usr/bin/env python3
# ============================================================================
# po2lmo.py — 纯 Python 实现的 PO -> LMO 编译器 (零外部依赖)
#
# LuCI 的客户端 i18n 依赖 .lmo (Lua Machine Object) 二进制语言包。本脚本
# 字节级复刻 luci-base 官方 C 工具 po2lmo(modules/luci-base/src/po2lmo.c +
# lib/lmo.c 的 sfh_hash)的输出, 使得在没有 OpenWrt SDK / 编译器的环境下,
# 本地打包脚本(build_ipk.sh / build_run.sh)也能生成可被 LuCI 正确加载的 lmo。
#
# 用法: python3 po2lmo.py input.po output.lmo
#
# 与官方一致的关键点:
#   * key_id = sfh_hash(msgid, len, init=len) —— 对无连续空白/换行的规范 msgid,
#     等价于运行时 lmo_canon_hash, 故 msgid 必须保持单行、无首尾/连续空白。
#   * 索引项 val_id 写入的是 (plural_num + 1)(非复数即 1), 而非值的 hash。
#   * 仅当 key_id != sfh_hash(msgstr) 时才写入(官方的去重保护)。
#   * 数据区每条 msgstr 以 4 字节对齐(补 0); 索引按 key_id 升序; 文件末尾
#     追加一个大端 uint32 = 数据区总长度(即索引区起始偏移)。
# ============================================================================
import sys


def sfh_get16(data, i):
    # 官方 sfh_get16: 小端 16 位读取
    return data[i] | (data[i + 1] << 8)


def sfh_hash(data, init):
    """SuperFastHash, 复刻 lib/lmo.c 的 sfh_hash(data, len, init=len)。"""
    length = len(data)
    if length <= 0:
        return 0
    M = 0xFFFFFFFF
    h = init & M
    rem = length & 3
    n = length >> 2
    i = 0
    while n > 0:
        h = (h + sfh_get16(data, i)) & M
        tmp = (((sfh_get16(data, i + 2) << 11) & M) ^ h) & M
        h = (((h << 16) & M) ^ tmp) & M
        i += 4
        h = (h + (h >> 11)) & M
        n -= 1
    if rem == 3:
        h = (h + sfh_get16(data, i)) & M
        h = (h ^ ((h << 16) & M)) & M
        sc = data[i + 2]
        if sc >= 128:
            sc -= 256
        h = (h ^ ((sc << 18) & M)) & M
        h = (h + (h >> 11)) & M
    elif rem == 2:
        h = (h + sfh_get16(data, i)) & M
        h = (h ^ ((h << 11) & M)) & M
        h = (h + (h >> 17)) & M
    elif rem == 1:
        sc = data[i]
        if sc >= 128:
            sc -= 256
        h = (h + sc) & M
        h = (h ^ ((h << 10) & M)) & M
        h = (h + (h >> 1)) & M
    # final avalanche
    h = (h ^ ((h << 3) & M)) & M
    h = (h + (h >> 5)) & M
    h = (h ^ ((h << 4) & M)) & M
    h = (h + (h >> 17)) & M
    h = (h ^ ((h << 25) & M)) & M
    h = (h + (h >> 6)) & M
    return h & M


def extract_string(src):
    """复刻 po2lmo.c 的 extract_string: 取出一行中双引号内的内容(bytes)。
    转义规则与官方一致: \\" -> " , \\\\ -> \\ , 其它 \\X 原样保留(含 \\n 不转换行)。
    注释行(# 开头)返回 None; 无引号返回 None。"""
    if src[:1] == b'#':
        return None
    dest = bytearray(len(src) + 1)
    off = -1
    esc = 0
    pos = 0
    n = len(src)
    while pos < n:
        c = src[pos]
        if off == -1:
            if c == 0x22:  # "
                off = pos + 1
        else:
            if esc == 1:
                if c == 0x22 or c == 0x5C:  # " 或 反斜杠 -> 吞掉前面写入的反斜杠
                    off += 1
                dest[pos - off] = c
                esc = 0
            elif c == 0x5C:  # 反斜杠
                dest[pos - off] = c
                esc = 1
            elif c != 0x22:
                dest[pos - off] = c
            else:  # 闭合引号
                return bytes(dest[:pos - off])
        pos += 1
    if off == -1:
        return None
    return bytes(dest[:max(0, pos - off)])


class Msg:
    __slots__ = ("ctxt", "id", "id_plural", "val", "cur")

    def __init__(self):
        self.ctxt = None
        self.id = None
        self.id_plural = None
        self.val = [None] * 10
        self.cur = None  # 当前累加目标: ('field', name) 或 ('val', idx)


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("Usage: po2lmo.py input.po output.lmo\n")
        return 1

    entries = []          # (key_id, val_id, offset, length)
    data = bytearray()    # 数据区
    offset = 0

    def set_field(msg, target):
        msg.cur = target

    def append_cur(msg, s):
        kind, name = msg.cur
        if kind == 'field':
            cur = getattr(msg, name)
            cur = (cur or b'') + s
            setattr(msg, name, cur)
        else:
            msg.val[name] = (msg.val[name] or b'') + s

    def print_msg(msg):
        nonlocal offset
        if msg.id and msg.val[0]:
            # 非复数 / 无 ctxt 是本项目唯一用到的情形; 同时兼容 ctxt/plural。
            plural_num = 0
            for i in range(10):
                v = msg.val[i]
                if v is None:
                    continue
                if i > 0 and not msg.id_plural:
                    break
                if msg.ctxt and msg.id_plural:
                    key = msg.ctxt + b'\1' + msg.id + b'\2' + str(i).encode()
                elif msg.ctxt:
                    key = msg.ctxt + b'\1' + msg.id
                elif msg.id_plural:
                    key = msg.id + b'\2' + str(i).encode()
                else:
                    key = msg.id
                key_id = sfh_hash(key, len(key))
                val_id_chk = sfh_hash(v, len(v))
                if key_id != val_id_chk:
                    length = len(v)
                    entries.append([key_id, plural_num + 1, offset, length])
                    data.extend(v)
                    pad = (4 - (length % 4)) % 4
                    data.extend(b'\0' * pad)
                    offset += length + pad
        elif msg.val[0]:
            # header(msgid "")分支: 仅提取 Plural-Forms 行。本项目 po 不含该行,
            # 故通常不产生条目; 保留以与官方对齐。
            field = msg.val[0]
            parts = field.split(b'\\n')
            for seg in parts:
                if seg[:14].lower() == b'plural-forms: ':
                    body = seg[14:]
                    length = len(body)
                    entries.append([0, 0, offset, length])
                    data.extend(body)
                    pad = (4 - (length % 4)) % 4
                    data.extend(b'\0' * pad)
                    offset += length + pad
                    break
        # reset
        msg.ctxt = None
        msg.id = None
        msg.id_plural = None
        msg.val = [None] * 10
        msg.cur = None

    with open(argv[1], 'rb') as f:
        lines = f.readlines()

    msg = Msg()
    i = 0
    total = len(lines)
    while i <= total:
        eof = (i == total)
        line = b'' if eof else lines[i]

        if line.startswith(b'msgctxt "'):
            if msg.id or msg.val[0]:
                print_msg(msg)
            msg.ctxt = None
            set_field(msg, ('field', 'ctxt'))
        elif eof or line.startswith(b'msgid "'):
            if msg.id or msg.val[0]:
                print_msg(msg)
            msg.id = None
            set_field(msg, ('field', 'id'))
        elif line.startswith(b'msgid_plural "'):
            msg.id_plural = None
            set_field(msg, ('field', 'id_plural'))
        elif line.startswith(b'msgstr "') or line.startswith(b'msgstr['):
            if line[6:7] == b'[':
                pnum = int(line[7:].split(b']')[0] or b'0')
            else:
                pnum = 0
            if pnum >= 10:
                sys.stderr.write("Too many plural forms\n")
                return 1
            msg.val[pnum] = None
            set_field(msg, ('val', pnum))

        if eof:
            break

        if msg.cur is not None:
            s = extract_string(line.rstrip(b'\r\n'))
            if s:
                append_cur(msg, s)
        i += 1

    # 写出: 数据区 + 索引(按 key_id 升序)+ 末尾 offset
    if offset == 0:
        # 与官方一致: 无内容则不生成文件
        return 0

    import struct
    entries.sort(key=lambda e: e[0])
    out = bytearray(data)
    for key_id, val_id, off, length in entries:
        out += struct.pack('>IIII', key_id, val_id, off, length)
    out += struct.pack('>I', offset)

    with open(argv[2], 'wb') as f:
        f.write(out)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
