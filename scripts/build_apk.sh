#!/bin/sh
# ============================================================================
# 本地构建 OpenWrt .apk 包
#
# 用法:
#   sh scripts/build_apk.sh [output_dir]
#   APK_TOOL=/path/to/openwrt/staging_dir/host/bin/apk sh scripts/build_apk.sh [output_dir]
#
# 说明:
#   OpenWrt 25.12+ 使用 apk 包格式。这里和 build_ipk.sh 一样本地组装安装
#   文件，再调用 apk mkpkg 生成 .apk；不需要完整跑 OpenWrt package/compile。
# ============================================================================
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PKG_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
OUT_DIR="${1:-$PKG_DIR/dist}"
case "$OUT_DIR" in
	/*) ;;
	*) OUT_DIR="$PKG_DIR/$OUT_DIR" ;;
esac
mkdir -p "$OUT_DIR"

PKG_NAME="luci-app-openclaw"
I18N_PKG_NAME="luci-i18n-openclaw-zh-cn"
PKG_VERSION=$(sed -n 's/^PKG_VERSION:=[[:space:]]*//p' "$PKG_DIR/Makefile" | tr -d '[:space:]')
[ -n "$PKG_VERSION" ] || PKG_VERSION="1.0.0"
PKG_RELEASE="1"
PKG_VERSION_RELEASE="${PKG_VERSION}-r${PKG_RELEASE}"
PKG_ARCH="noarch"
PKG_DEPENDS="luci-base rpcd-mod-ucode curl openssl-util script-utils ttyd qrencode libstdcpp shadow-utils shadow-su"

APK_TOOL="${APK_TOOL:-}"
if [ -z "$APK_TOOL" ]; then
	APK_TOOL=$(command -v apk 2>/dev/null || true)
fi
[ -n "$APK_TOOL" ] || {
	echo "错误: 未找到 apk 工具。" >&2
	echo "请安装 apk-tools，或指定 OpenWrt 主机工具，例如:" >&2
	echo "  APK_TOOL=/path/to/openwrt/staging_dir/host/bin/apk sh scripts/build_apk.sh" >&2
	exit 1
}

echo "=== 构建 ${PKG_NAME} .apk 包 ==="
echo "apk 工具: $APK_TOOL"

STAGING=$(mktemp -d)
trap "rm -rf '$STAGING'" EXIT

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

# LuCI i18n 中文语言包不放入 .apk 主包。
# OpenWrt 25.12+ 的 apk 包体系会把翻译拆到 luci-i18n-openclaw-zh-cn；
# 若主包也携带同名 lmo，升级时会与该 i18n 包发生文件所有权冲突。

# LuCI menu and rpcd ucode backend
mkdir -p "$DATA_DIR/usr/share/luci/menu.d" "$DATA_DIR/usr/share/rpcd/ucode"
cp "$PKG_DIR/root/usr/share/luci/menu.d/luci-app-openclaw.json" "$DATA_DIR/usr/share/luci/menu.d/"
cp "$PKG_DIR/root/usr/share/rpcd/ucode/luci.openclaw" "$DATA_DIR/usr/share/rpcd/ucode/"
chmod +x "$DATA_DIR/usr/share/rpcd/ucode/luci.openclaw"

# rpcd ACL
mkdir -p "$DATA_DIR/usr/share/rpcd/acl.d"
cp "$PKG_DIR/root/usr/share/rpcd/acl.d/"*.json "$DATA_DIR/usr/share/rpcd/acl.d/"

# openclaw 共享资源
mkdir -p "$DATA_DIR/usr/share/openclaw"
printf '%s\n' "$PKG_VERSION" > "$DATA_DIR/usr/share/openclaw/VERSION"

# apk conffile metadata used by OpenWrt package database
mkdir -p "$DATA_DIR/lib/apk/packages"
printf '/etc/config/openclaw\n' > "$DATA_DIR/lib/apk/packages/${PKG_NAME}.conffiles"
if command -v sha256sum >/dev/null 2>&1; then
	CONFIG_SUM=$(sha256sum "$DATA_DIR/etc/config/openclaw" | awk '{print $1}')
	printf '/etc/config/openclaw %s\n' "$CONFIG_SUM" > "$DATA_DIR/lib/apk/packages/${PKG_NAME}.conffiles_static"
elif command -v openssl >/dev/null 2>&1; then
	CONFIG_SUM=$(openssl dgst -sha256 "$DATA_DIR/etc/config/openclaw" | awk '{print $NF}')
	printf '/etc/config/openclaw %s\n' "$CONFIG_SUM" > "$DATA_DIR/lib/apk/packages/${PKG_NAME}.conffiles_static"
fi
(cd "$DATA_DIR" && find . -type f -o -type l) | sed 's|^\./|/|' | sort > "$DATA_DIR/lib/apk/packages/${PKG_NAME}.list"

INSTALLED_SIZE=$(du -sk "$DATA_DIR" | awk '{print $1}')

SCRIPT_DIR_TMP="$STAGING/scripts"
mkdir -p "$SCRIPT_DIR_TMP"

cat > "$SCRIPT_DIR_TMP/post-install" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	OLD_CONFIG="/etc/config/openclaw"
	NEW_CONFIG=""
	for candidate in /etc/config/openclaw-apk /etc/config/openclaw.apk-new; do
		[ -f "$candidate" ] && { NEW_CONFIG="$candidate"; break; }
	done

	restore_option() {
		[ -z "$2" ] || uci set "openclaw.main.$1=$2"
	}

	if [ -n "$NEW_CONFIG" ] && [ -f "$NEW_CONFIG" ]; then
		echo "检测到配置文件冲突，正在智能合并..."

		USER_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)

		cp "$OLD_CONFIG" /etc/config/openclaw.user.bak 2>/dev/null || true
		mv "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || cp "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || true
		rm -f "$NEW_CONFIG" 2>/dev/null || true

		restore_option enabled "$USER_ENABLED"
		restore_option port "$USER_PORT"
		restore_option bind "$USER_BIND"
		restore_option token "$USER_TOKEN"
		restore_option install_path "$USER_INSTALL_PATH"
		uci commit openclaw
		echo "配置合并完成，用户设置已保留"
	elif [ -f /etc/config/openclaw.pre-upgrade.bak ]; then
		BAK="/etc/config/openclaw.pre-upgrade.bak"
		B_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		restore_option enabled "$B_ENABLED"
		restore_option port "$B_PORT"
		restore_option bind "$B_BIND"
		restore_option token "$B_TOKEN"
		restore_option install_path "$B_INSTALL_PATH"
		uci commit openclaw
		echo "已从升级前备份还原用户配置(install_path 等)"
	fi
	rm -f /etc/config/openclaw.pre-upgrade.bak 2>/dev/null || true

	if [ -f /etc/uci-defaults/99-openclaw ]; then
		( . /etc/uci-defaults/99-openclaw ) && rm -f /etc/uci-defaults/99-openclaw
	fi
	rm -f /usr/lib/lua/luci/controller/openclaw.lua
	rm -rf /usr/lib/lua/luci/model/cbi/openclaw /usr/lib/lua/luci/view/openclaw /usr/lib/lua/openclaw
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json /tmp/luci-openclaw-status.* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	exit 0
}
EOF
chmod +x "$SCRIPT_DIR_TMP/post-install"

cat > "$SCRIPT_DIR_TMP/post-upgrade" << 'EOF'
#!/bin/sh
export PKG_UPGRADE=1
[ -n "${IPKG_INSTROOT}" ] || {
	OLD_CONFIG="/etc/config/openclaw"
	NEW_CONFIG=""
	for candidate in /etc/config/openclaw-apk /etc/config/openclaw.apk-new; do
		[ -f "$candidate" ] && { NEW_CONFIG="$candidate"; break; }
	done

	restore_option() {
		[ -z "$2" ] || uci set "openclaw.main.$1=$2"
	}

	if [ -n "$NEW_CONFIG" ] && [ -f "$NEW_CONFIG" ]; then
		echo "检测到配置文件冲突，正在智能合并..."

		USER_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)
		USER_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$OLD_CONFIG" 2>/dev/null | tail -1)

		cp "$OLD_CONFIG" /etc/config/openclaw.user.bak 2>/dev/null || true
		mv "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || cp "$NEW_CONFIG" "$OLD_CONFIG" 2>/dev/null || true
		rm -f "$NEW_CONFIG" 2>/dev/null || true

		restore_option enabled "$USER_ENABLED"
		restore_option port "$USER_PORT"
		restore_option bind "$USER_BIND"
		restore_option token "$USER_TOKEN"
		restore_option install_path "$USER_INSTALL_PATH"
		uci commit openclaw
		echo "配置合并完成，用户设置已保留"
	elif [ -f /etc/config/openclaw.pre-upgrade.bak ]; then
		BAK="/etc/config/openclaw.pre-upgrade.bak"
		B_ENABLED=$(sed -n "s/^\s*option\s\+enabled\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_PORT=$(sed -n "s/^\s*option\s\+port\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_BIND=$(sed -n "s/^\s*option\s\+bind\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_TOKEN=$(sed -n "s/^\s*option\s\+token\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		B_INSTALL_PATH=$(sed -n "s/^\s*option\s\+install_path\s\+['\"]\?\([^'\"]*\)['\"]\?.*/\1/p" "$BAK" 2>/dev/null | tail -1)
		restore_option enabled "$B_ENABLED"
		restore_option port "$B_PORT"
		restore_option bind "$B_BIND"
		restore_option token "$B_TOKEN"
		restore_option install_path "$B_INSTALL_PATH"
		uci commit openclaw
		echo "已从升级前备份还原用户配置(install_path 等)"
	fi
	rm -f /etc/config/openclaw.pre-upgrade.bak 2>/dev/null || true

	if [ -f /etc/uci-defaults/99-openclaw ]; then
		( . /etc/uci-defaults/99-openclaw ) && rm -f /etc/uci-defaults/99-openclaw
	fi
	rm -f /usr/lib/lua/luci/controller/openclaw.lua
	rm -rf /usr/lib/lua/luci/model/cbi/openclaw /usr/lib/lua/luci/view/openclaw /usr/lib/lua/openclaw
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json /tmp/luci-openclaw-status.* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	exit 0
}
EOF
chmod +x "$SCRIPT_DIR_TMP/post-upgrade"

cat > "$SCRIPT_DIR_TMP/pre-deinstall" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	if [ -f /etc/config/openclaw ]; then
		cp /etc/config/openclaw /etc/config/openclaw.pre-upgrade.bak 2>/dev/null || true
	fi
	exit 0
}
EOF
chmod +x "$SCRIPT_DIR_TMP/pre-deinstall"

cat > "$SCRIPT_DIR_TMP/post-deinstall" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	if [ "${PKG_UPGRADE}" != "1" ]; then
		rm -f /etc/config/openclaw /etc/config/openclaw-opkg /etc/config/openclaw*.bak 2>/dev/null
		rm -rf /tmp/openclaw 2>/dev/null
		rm -f /tmp/openclaw-* /tmp/luci-openclaw-* 2>/dev/null
	fi
	exit 0
}
EOF
chmod +x "$SCRIPT_DIR_TMP/post-deinstall"

APK_FILE="$OUT_DIR/${PKG_NAME}-${PKG_VERSION_RELEASE}.apk"
rm -f "$APK_FILE"

"$APK_TOOL" mkpkg \
	--info "name:${PKG_NAME}" \
	--info "version:${PKG_VERSION_RELEASE}" \
	--info "description:OpenClaw AI 网关 LuCI 管理插件" \
	--info "arch:${PKG_ARCH}" \
	--info "license:GPL-3.0" \
	--info "origin:${PKG_NAME}" \
	--info "url:https://github.com/tonylee2022/luci-app-openclaw" \
	--info "maintainer:tonylee2022 <tonylee2022@users.noreply.github.com>" \
	--info "depends:${PKG_DEPENDS}" \
	--script "post-install:${SCRIPT_DIR_TMP}/post-install" \
	--script "post-upgrade:${SCRIPT_DIR_TMP}/post-upgrade" \
	--script "pre-deinstall:${SCRIPT_DIR_TMP}/pre-deinstall" \
	--script "post-deinstall:${SCRIPT_DIR_TMP}/post-deinstall" \
	--files "$DATA_DIR" \
	--output "$APK_FILE"

APK_SIZE=$(wc -c < "$APK_FILE" | tr -d ' ')

I18N_APK_FILE=""
I18N_INSTALLED_SIZE=""
if [ -f "$PKG_DIR/po/zh_Hans/openclaw.po" ]; then
	if command -v python3 >/dev/null 2>&1; then
		I18N_DATA_DIR="$STAGING/i18n-data"
		mkdir -p "$I18N_DATA_DIR/usr/lib/lua/luci/i18n" "$I18N_DATA_DIR/lib/apk/packages"

		python3 "$PKG_DIR/scripts/po2lmo.py" "$PKG_DIR/po/zh_Hans/openclaw.po" \
			"$I18N_DATA_DIR/usr/lib/lua/luci/i18n/openclaw.zh-cn.lmo"

		(cd "$I18N_DATA_DIR" && find . -type f -o -type l) | sed 's|^\./|/|' | sort > "$I18N_DATA_DIR/lib/apk/packages/${I18N_PKG_NAME}.list"
		I18N_INSTALLED_SIZE=$(du -sk "$I18N_DATA_DIR" | awk '{print $1}')

		cat > "$SCRIPT_DIR_TMP/i18n-post-install" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json 2>/dev/null
	exit 0
}
EOF
		chmod +x "$SCRIPT_DIR_TMP/i18n-post-install"

		cat > "$SCRIPT_DIR_TMP/i18n-post-upgrade" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json 2>/dev/null
	exit 0
}
EOF
		chmod +x "$SCRIPT_DIR_TMP/i18n-post-upgrade"

		cat > "$SCRIPT_DIR_TMP/i18n-post-deinstall" << 'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-indexcache.*.json 2>/dev/null
	exit 0
}
EOF
		chmod +x "$SCRIPT_DIR_TMP/i18n-post-deinstall"

		I18N_APK_FILE="$OUT_DIR/${I18N_PKG_NAME}-${PKG_VERSION_RELEASE}.apk"
		rm -f "$I18N_APK_FILE"
		"$APK_TOOL" mkpkg \
			--info "name:${I18N_PKG_NAME}" \
			--info "version:${PKG_VERSION_RELEASE}" \
			--info "description:Simplified Chinese translation for luci-app-openclaw" \
			--info "arch:${PKG_ARCH}" \
			--info "license:GPL-3.0" \
			--info "origin:${PKG_NAME}" \
			--info "url:https://github.com/tonylee2022/luci-app-openclaw" \
			--info "maintainer:tonylee2022 <tonylee2022@users.noreply.github.com>" \
			--info "depends:${PKG_NAME}" \
			--script "post-install:${SCRIPT_DIR_TMP}/i18n-post-install" \
			--script "post-upgrade:${SCRIPT_DIR_TMP}/i18n-post-upgrade" \
			--script "post-deinstall:${SCRIPT_DIR_TMP}/i18n-post-deinstall" \
			--files "$I18N_DATA_DIR" \
			--output "$I18N_APK_FILE"
	else
		echo "警告: 未找到 python3, 跳过中文语言包生成 (界面将仅显示英文)" >&2
	fi
fi

echo ""
echo "=== 构建完成 ==="
echo "输出文件: $APK_FILE"
echo "文件大小: ${APK_SIZE} bytes"
echo "安装大小: ${INSTALLED_SIZE} KB"
if [ -n "$I18N_APK_FILE" ]; then
	I18N_APK_SIZE=$(wc -c < "$I18N_APK_FILE" | tr -d ' ')
	echo "语言包: $I18N_APK_FILE"
	echo "语言包大小: ${I18N_APK_SIZE} bytes"
	echo "语言包安装大小: ${I18N_INSTALLED_SIZE} KB"
fi
echo ""
if [ -n "$I18N_APK_FILE" ]; then
	echo "安装方法: apk add --allow-untrusted ${PKG_NAME}-${PKG_VERSION_RELEASE}.apk ${I18N_PKG_NAME}-${PKG_VERSION_RELEASE}.apk"
else
	echo "安装方法: apk add --allow-untrusted ${PKG_NAME}-${PKG_VERSION_RELEASE}.apk"
fi
