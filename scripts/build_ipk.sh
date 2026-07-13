#!/bin/sh
# ============================================================================
# 本地构建 .ipk 包 (无需 OpenWrt SDK)
# 用法: sh scripts/build_ipk.sh [output_dir]
# ============================================================================
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PKG_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
OUT_DIR="${1:-$PKG_DIR/dist}"
# 确保 OUT_DIR 是绝对路径
case "$OUT_DIR" in
	/*) ;;
	*) OUT_DIR="$PKG_DIR/$OUT_DIR" ;;
esac
mkdir -p "$OUT_DIR"
PKG_NAME="luci-app-openclaw"
PKG_VERSION=$(sed -n 's/^PKG_VERSION:=[[:space:]]*//p' "$PKG_DIR/Makefile" | tr -d '[:space:]')
[ -n "$PKG_VERSION" ] || PKG_VERSION="1.0.0"
PKG_RELEASE="1"

echo "=== 构建 ${PKG_NAME} .ipk 包 ==="

STAGING=$(mktemp -d)
trap "rm -rf '$STAGING'" EXIT

# ── 构建 data.tar.gz ──
DATA_DIR="$STAGING/data"
mkdir -p "$DATA_DIR"

# UCI config
mkdir -p "$DATA_DIR/etc/config"
cp "$PKG_DIR/root/etc/config/openclaw" "$DATA_DIR/etc/config/"

# UCI defaults
mkdir -p "$DATA_DIR/etc/uci-defaults"
cp "$PKG_DIR/root/etc/uci-defaults/99-openclaw" "$DATA_DIR/etc/uci-defaults/"
chmod +x "$DATA_DIR/etc/uci-defaults/99-openclaw"

# init.d
mkdir -p "$DATA_DIR/etc/init.d"
cp "$PKG_DIR/root/etc/init.d/openclaw" "$DATA_DIR/etc/init.d/"
chmod +x "$DATA_DIR/etc/init.d/openclaw"

# bin
mkdir -p "$DATA_DIR/usr/bin"
cp "$PKG_DIR/root/usr/bin/openclaw-env" "$PKG_DIR/root/usr/bin/openclaw" "$PKG_DIR/root/usr/bin/openclaw-shell" "$DATA_DIR/usr/bin/"
chmod +x "$DATA_DIR/usr/bin/openclaw-env" "$DATA_DIR/usr/bin/openclaw" "$DATA_DIR/usr/bin/openclaw-shell"

# shared shell helpers
mkdir -p "$DATA_DIR/usr/libexec"
cp "$PKG_DIR/root/usr/libexec/"*.sh "$DATA_DIR/usr/libexec/"
chmod +x "$DATA_DIR/usr/libexec/"*.sh

# Modern LuCI JavaScript views and resources
mkdir -p "$DATA_DIR/www/luci-static/resources/openclaw" "$DATA_DIR/www/luci-static/resources/view/openclaw"
cp "$PKG_DIR/htdocs/luci-static/resources/openclaw/"* "$DATA_DIR/www/luci-static/resources/openclaw/"
cp "$PKG_DIR/htdocs/luci-static/resources/view/openclaw/"*.js "$DATA_DIR/www/luci-static/resources/view/openclaw/"

# LuCI i18n 中文语言包: po -> lmo (纯 Python po2lmo, 无需 OpenWrt SDK)。
# 文件名用 LuCI 的简体中文别名 zh-cn (对应 po/zh_Hans/, 见 luci.mk LUCI_LC_ALIAS)。
if [ -f "$PKG_DIR/po/zh_Hans/openclaw.po" ]; then
	if command -v python3 >/dev/null 2>&1; then
		mkdir -p "$DATA_DIR/usr/lib/lua/luci/i18n"
		python3 "$PKG_DIR/scripts/po2lmo.py" "$PKG_DIR/po/zh_Hans/openclaw.po" \
			"$DATA_DIR/usr/lib/lua/luci/i18n/openclaw.zh-cn.lmo"
	else
		echo "警告: 未找到 python3, 跳过中文语言包生成 (界面将仅显示英文)" >&2
	fi
fi

# LuCI menu and rpcd ucode backend
mkdir -p "$DATA_DIR/usr/share/luci/menu.d" "$DATA_DIR/usr/share/rpcd/ucode"
cp "$PKG_DIR/root/usr/share/luci/menu.d/luci-app-openclaw.json" "$DATA_DIR/usr/share/luci/menu.d/"
cp "$PKG_DIR/root/usr/share/rpcd/ucode/luci.openclaw" "$DATA_DIR/usr/share/rpcd/ucode/"
chmod +x "$DATA_DIR/usr/share/rpcd/ucode/luci.openclaw"

# rpcd ACL
mkdir -p "$DATA_DIR/usr/share/rpcd/acl.d"
cp "$PKG_DIR/root/usr/share/rpcd/acl.d/"*.json "$DATA_DIR/usr/share/rpcd/acl.d/"

# openclaw 共享资源 (运行时版本文件, 由 PKG_VERSION 生成; web-pty/oc-config 配置菜单已退役)
mkdir -p "$DATA_DIR/usr/share/openclaw"
printf '%s\n' "$PKG_VERSION" > "$DATA_DIR/usr/share/openclaw/VERSION"

# 计算安装大小
INSTALLED_SIZE=$(du -sk "$DATA_DIR" | awk '{print $1}')

(cd "$DATA_DIR" && tar czf "$STAGING/data.tar.gz" .)

# ── 构建 control.tar.gz ──
CTRL_DIR="$STAGING/control"
mkdir -p "$CTRL_DIR"

cat > "$CTRL_DIR/control" << EOF
Package: ${PKG_NAME}
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: luci-base, rpcd-mod-ucode, curl, openssl-util, script-utils, ttyd, qrencode, libstdcpp, shadow-utils, shadow-su
Source: https://github.com/tonylee2022/luci-app-openclaw
SourceName: ${PKG_NAME}
License: GPL-3.0
Section: luci
SourceDateEpoch: $(date +%s)
Maintainer: tonylee2022 <tonylee2022@users.noreply.github.com>
Architecture: all
Installed-Size: ${INSTALLED_SIZE}
Description: OpenClaw AI 网关 LuCI 管理插件
EOF

cat > "$CTRL_DIR/postinst" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	# ══════════════════════════════════════════════════════════════
	# 配置文件冲突处理 (opkg 将新配置保存为 .opkg 后缀)
	# ══════════════════════════════════════════════════════════════
	# opkg 配置文件冲突处理流程:
	# 1. opkg 检测到 /etc/config/openclaw 已存在且内容不同
	# 2. opkg 保留旧配置，将新配置保存为 /etc/config/openclaw-opkg
	# 3. postinst 需要合并用户配置到新配置文件
	
	OLD_CONFIG="/etc/config/openclaw"
	NEW_CONFIG="/etc/config/openclaw-opkg"

	restore_option() {
		[ -z "$2" ] || uci set "openclaw.main.$1=$2"
	}
	
	if [ -f "$NEW_CONFIG" ]; then
		echo "检测到配置文件冲突，正在智能合并..."
		
		# 步骤1: 从旧配置中提取用户设置 (在替换之前!)
		# 使用 sed 直接解析 UCI 格式，不依赖 uci 命令
		USER_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		
		# 步骤2: 备份旧配置 (固定名, 避免每次升级累积备份)
		cp "$OLD_CONFIG" /etc/config/openclaw.user.bak 2>/dev/null || true
		echo "旧配置已备份到: /etc/config/openclaw.user.bak"
		
		# 步骤3: 使用新配置文件
		mv "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || cp "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || true
		rm -f "$NEW_CONFIG" 2>/dev/null || true
		
		# 步骤4: 合并用户设置到新配置。通过 uci 传值，避免 token 等值中的
		# '&'、反斜杠或引号被当作 sed 替换语法。
		restore_option enabled "$USER_ENABLED"
		restore_option port "$USER_PORT"
		restore_option bind "$USER_BIND"
		restore_option token "$USER_TOKEN"
		restore_option install_path "$USER_INSTALL_PATH"
		uci commit openclaw
		
		echo "配置合并完成，用户设置已保留"
	elif [ -f /etc/config/openclaw.pre-upgrade.bak ]; then
		# opkg --force-reinstall(插件升级走此路径)会直接用包内默认覆盖 conffile, 不生成 -opkg。
		# 从 prerm 在本次升级开始时所备份的 .pre-upgrade.bak 还原用户设置, 避免 install_path/token 等丢失。
		BAK="/etc/config/openclaw.pre-upgrade.bak"
		B_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$BAK" 2>/dev/null | tail -1)
		B_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$BAK" 2>/dev/null | tail -1)
		B_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$BAK" 2>/dev/null | tail -1)
		B_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$BAK" 2>/dev/null | tail -1)
		B_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\\?\\([^'\"]*\\)['\"]\\?.*/\\1/p" "$BAK" 2>/dev/null | tail -1)
		restore_option enabled "$B_ENABLED"
		restore_option port "$B_PORT"
		restore_option bind "$B_BIND"
		restore_option token "$B_TOKEN"
		restore_option install_path "$B_INSTALL_PATH"
		uci commit openclaw
		echo "已从升级前备份还原用户配置(install_path 等)"
	fi
	# 消费掉本次升级备份, 避免下次非升级安装误用陈旧值。
	rm -f /etc/config/openclaw.pre-upgrade.bak 2>/dev/null || true

	# 执行 uci-defaults 初始化脚本
	if [ -f /etc/uci-defaults/99-openclaw ]; then
		( . /etc/uci-defaults/99-openclaw ) && rm -f /etc/uci-defaults/99-openclaw
	fi

	# 清理旧版 Lua Controller/CBI/View，避免 .run 或跨架构升级残留旧菜单。
	rm -f /usr/lib/lua/luci/controller/openclaw.lua
	rm -rf /usr/lib/lua/luci/model/cbi/openclaw /usr/lib/lua/luci/view/openclaw /usr/lib/lua/openclaw
	
	# 清理 LuCI 缓存与本插件状态缓存(后者含插件版本等, 升级后须刷新)
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json /tmp/luci-openclaw-status.* 2>/dev/null

	# 旧版残留的 root 配置终端进程由 uci-defaults 在升级时清理 (见 99-openclaw)。

	# 重载 rpcd 使新 ucode 后端(luci.openclaw 对象)立即注册。
	# 必须在 postinst 末尾(新文件已就位后)执行: 升级时 opkg 先删旧文件→跑旧 postrm(其 reload 会在
	# 模块文件缺失的空档注销对象)→再装新文件→本 postinst, 此处 reload 把对象重新注册回来,
	# 否则前端轮询 luci.openclaw/* 全部 "Object not found" 导致界面卡死。reload 为 SIGHUP, 保留登录会话。
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	exit 0
}
EOF
chmod +x "$CTRL_DIR/postinst"

cat > "$CTRL_DIR/prerm" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	# 升级前备份当前配置
	if [ -f /etc/config/openclaw ]; then
		cp /etc/config/openclaw /etc/config/openclaw.pre-upgrade.bak 2>/dev/null || true
	fi
}
EOF
chmod +x "$CTRL_DIR/prerm"

cat > "$CTRL_DIR/postrm" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	# 完全卸载时(非升级)收尾: 清理 conffile 本体、opkg 冲突副本与所有备份残留, 以及 /tmp 中的任务/缓存/日志残留。
	# opkg 升级时会设 PKG_UPGRADE=1, 真正卸载时未设; 仅真卸载才清理(opkg 默认保留 modified conffile)。
	if [ "${PKG_UPGRADE}" != "1" ]; then
		rm -f /etc/config/openclaw /etc/config/openclaw-opkg /etc/config/openclaw*.bak 2>/dev/null
		rm -rf /tmp/openclaw 2>/dev/null
		rm -f /tmp/openclaw-* /tmp/luci-openclaw-* 2>/dev/null
	fi
}
EOF
chmod +x "$CTRL_DIR/postrm"

cat > "$CTRL_DIR/conffiles" << 'EOF'
/etc/config/openclaw
EOF

(cd "$CTRL_DIR" && tar czf "$STAGING/control.tar.gz" .)

# ── 组装 .ipk (OpenWrt/opkg 使用 ar 容器) ──
mkdir -p "$OUT_DIR"
IPK_FILE="$OUT_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"

echo "2.0" > "$STAGING/debian-binary"

# 清理旧文件
rm -f "$IPK_FILE"

# 组装 .ipk: ar 容器中依次放 debian-binary、control.tar.gz、data.tar.gz。
(cd "$STAGING" && ar r "$IPK_FILE" debian-binary control.tar.gz data.tar.gz >/dev/null)

IPK_SIZE=$(wc -c < "$IPK_FILE" | tr -d ' ')
echo ""
echo "=== 构建完成 ==="
echo "输出文件: $IPK_FILE"
echo "文件大小: ${IPK_SIZE} bytes"
echo "安装大小: ${INSTALLED_SIZE} KB"
echo ""
echo "安装方法: opkg install ${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"

if [ "${BUILD_RUN:-1}" != "0" ]; then
	# ── 同步构建 .run 包 ──
	echo ""
	echo "=== 同步构建 .run 包 ==="
	"$SCRIPT_DIR/build_run.sh" "$OUT_DIR"
fi
