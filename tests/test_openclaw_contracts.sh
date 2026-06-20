#!/bin/sh
set -eu

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

grep -Fq ') </dev/null >/dev/null 2>&1 &' root/usr/libexec/openclaw-rpc.sh || fail "background task shell must detach from rpcd stdio"
grep -Fq 'rm -f "${prefix}.pid"' root/usr/libexec/openclaw-rpc.sh || fail "completed and stale task PID files must be removed"

# 从 VERSION.json 读取期望版本号（单一真相来源）
[ -f VERSION.json ] || fail "VERSION.json must exist as the canonical version source"
_OC_VER=$(grep '"oc_tested_version"' VERSION.json | sed 's/.*"oc_tested_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
_NODE_VER=$(grep '"node_version"' VERSION.json | sed 's/.*"node_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
_NODE_MIN_VER=$(grep '"node_min_version"' VERSION.json | sed 's/.*"node_min_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
[ -n "$_OC_VER" ] || fail "VERSION.json must contain oc_tested_version"
[ -n "$_NODE_VER" ] || fail "VERSION.json must contain node_version"
[ -n "$_NODE_MIN_VER" ] || fail "VERSION.json must contain node_min_version"

grep -q "OC_TESTED_VERSION=\"${_OC_VER}\"" root/usr/bin/openclaw-env || fail "tested OpenClaw version not pinned (expected ${_OC_VER} per VERSION.json)"
grep -q 'prefix="OC_VERSION=$(oc_quote "$version")' root/usr/libexec/openclaw-rpc.sh || fail "RPC setup must pass stable/latest through unchanged"
if grep -q 'OC_VERSION=$(oc_quote "$ver")' root/usr/libexec/openclaw-rpc.sh; then
	fail "RPC setup must not pass a concrete version to the stable/latest installer interface"
fi
if grep -Eq 'pgrep[[:space:]]+-u[[:space:]]+openclaw|pkill[^\n]*-u[[:space:]]+openclaw' root/etc/init.d/openclaw; then
	fail "service stop must not kill every process sharing the openclaw UID"
fi
# 允许用户驱动的 openclaw-weixin 渠道生命周期(安装/启用/升级/卸载), 但仍禁止改动
# 任何插件的 allow/deny/entries/installs 策略或对其它插件 enable/disable。
if grep -R -n -E --exclude='*.min.js' \
	'plugins\.(allow|deny|entries|installs)|plugins\[.(allow|deny|entries|installs)|plugins[[:space:]]+(enable|disable)' \
	root/etc root/usr/bin root/usr/libexec root/usr/share/openclaw 2>/dev/null \
	| grep -v 'openclaw-weixin' | grep -q .; then
	fail "project must not modify OpenClaw plugin enablement or security policy (except the user-driven openclaw-weixin channel)"
fi
grep -q "NODE_VERSION_V2=\"${_NODE_VER}\"" root/usr/bin/openclaw-env || fail "default Node.js version not pinned (expected ${_NODE_VER} per VERSION.json)"
grep -q "OC_NODE_MIN_VERSION=\"\${OC_NODE_MIN_VERSION:-${_NODE_MIN_VER}}\"" root/usr/bin/openclaw-env || fail "minimum Node.js version not pinned (expected ${_NODE_MIN_VER} per VERSION.json)"
grep -q "OC_NODE_MIN_VERSION=\"\${OC_NODE_MIN_VERSION:-${_NODE_MIN_VER}}\"" root/etc/init.d/openclaw || fail "service minimum Node.js version not aligned (expected ${_NODE_MIN_VER} per VERSION.json)"
grep -q "oc_assert_node_min_version" root/usr/bin/openclaw-env || fail "Node.js minimum version check missing"
grep -A5 '# Node.js' root/usr/bin/openclaw-env | grep -q 'assert_node_runtime' || fail "environment check must validate Node.js version"
if grep -q 'NODE_VERSION_V1\|v1_tarball' root/usr/bin/openclaw-env; then
	fail "installer must not fall back to a Node.js version below the minimum"
fi
grep -q 'OC_GLOBAL="${OC_ROOT}/.npm-global"' root/usr/libexec/openclaw-paths.sh || fail "npm prefix must use the new HOME layout"
grep -q 'OC_STATE_DIR="${OC_HOME}/.openclaw"' root/usr/libexec/openclaw-paths.sh || fail "state dir must use the new HOME layout"
grep -q 'reject_legacy_layout' root/usr/bin/openclaw-env || fail "installer must reject legacy layouts"
# ARM64/x64 musl Node 现由 unofficial-builds 提供, 不再自托管自建。
if grep -q 'NODE_SELF_HOST' root/usr/bin/openclaw-env; then
	fail "installer must not reference retired self-hosted Node binaries"
fi

grep -q "htdocs/luci-static/resources/view/openclaw" Makefile || fail "Makefile must install modern LuCI views"
grep -q "rpcd/ucode/luci.openclaw" Makefile || fail "Makefile must install rpcd ucode backend"
grep -q "rpcd-mod-ucode" Makefile || fail "modern LuCI package must depend on rpcd-mod-ucode"
if grep -q "luci-compat" Makefile scripts/build_ipk.sh scripts/build_run.sh; then
	fail "modern LuCI package must not depend on luci-compat"
fi
if grep -q "openclaw.zh-cn.lmo" Makefile; then
	fail "main package must not install openclaw.zh-cn.lmo"
fi

grep -q 'export HOME="$OC_HOME"' root/usr/bin/openclaw || fail "openclaw wrapper must inject HOME locally"
grep -q 'export NPM_CONFIG_PREFIX="$OC_GLOBAL"' root/usr/bin/openclaw || fail "openclaw wrapper must inject npm prefix"
grep -q 'export NPM_CONFIG_CACHE="$OC_NPM_CACHE"' root/usr/bin/openclaw || fail "openclaw wrapper must inject npm cache"
grep -q 'export TMPDIR="$OC_TMP"' root/usr/bin/openclaw || fail "openclaw wrapper must inject tmp dir"
grep -q 'configured_path="${OPENCLAW_INSTALL_PATH:-' root/usr/bin/openclaw || fail "openclaw wrapper must support a custom install path"
grep -Fq "HOME='\$OC_HOME'" root/usr/bin/openclaw-shell || fail "temporary shell must inject HOME locally"
grep -Fq "OPENCLAW_STATE_DIR='\$OC_STATE_DIR'" root/usr/bin/openclaw-shell || fail "temporary shell must inject state dir"
grep -Fq "NPM_CONFIG_PREFIX='\$OC_GLOBAL'" root/usr/bin/openclaw-shell || fail "temporary shell must inject npm prefix"
grep -Fq "NPM_CONFIG_CACHE='\$OC_NPM_CACHE'" root/usr/bin/openclaw-shell || fail "temporary shell must inject npm cache"
grep -Fq "TMPDIR='\$OC_TMP'" root/usr/bin/openclaw-shell || fail "temporary shell must inject tmp dir"
grep -q 'configured_path="${OPENCLAW_INSTALL_PATH:-' root/usr/bin/openclaw-shell || fail "temporary shell must support a custom install path"
grep -q 'exec /usr/bin/zsh -f' root/usr/bin/openclaw-shell || fail "temporary shell must use isolated zsh"
[ ! -e root/etc/profile.d/openclaw.sh ] || fail "profile.d script must be generated at runtime, not shipped in the package"
# 允许安装脚本 (openclaw-env / openclaw-rpc.sh) 在运行时生成 profile.d；
# 禁止在文档、构建脚本、配置文件、前端代码中硬编码引用。
if grep -R -q 'profile.d/openclaw.sh' README.md CHANGELOG.md Makefile scripts root/etc root/usr/share htdocs .github; then
	fail "profile.d/openclaw.sh must not be referenced in docs, config, or build files"
fi
grep -q 'write_profile_d' root/usr/bin/openclaw-env || fail "openclaw-env must define write_profile_d to configure npm prefix for login shells"
if grep -q 'export HOME=' README.md; then
	fail "documentation must not recommend changing the parent shell HOME"
fi
grep -q 'local target_pkg="openclaw@latest"' root/usr/bin/openclaw-env || fail "upgrade must target npm latest"

for view in overview advanced console; do
	[ -f "htdocs/luci-static/resources/view/openclaw/$view.js" ] || fail "missing modern LuCI view: $view"
done
[ -f root/usr/share/luci/menu.d/luci-app-openclaw.json ] || fail "menu.d definition missing"
[ -f root/usr/share/rpcd/ucode/luci.openclaw ] || fail "rpcd ucode backend missing"
[ -f root/usr/libexec/openclaw-rpc.sh ] || fail "rpc action helper missing"
[ ! -e luasrc/controller/openclaw.lua ] || fail "legacy Lua controller must be removed"
[ ! -e luasrc/model/cbi/openclaw/basic.lua ] || fail "legacy CBI model must be removed"
if find luasrc -type f 2>/dev/null | grep -q .; then fail "legacy luasrc files must be removed"; fi
grep -Fq "return { 'luci.openclaw': methods };" root/usr/share/rpcd/ucode/luci.openclaw || fail "ubus object export missing"
grep -Fq 'node: base + ' root/usr/share/rpcd/ucode/luci.openclaw || fail "ucode paths() must place node under base (not root) to match shell-side NODE_BASE"
for method in status system_info install_path_probe update_check setup_log upgrade_log backup_list backup_verify gateway_token wechat_status wechat_install_log wechat_login_status wechat_update_check service_action setup uninstall upgrade backup_create backup_restore backup_delete wechat_install wechat_login wechat_logout wechat_upgrade wechat_uninstall; do
	grep -q "${method}:" root/usr/share/rpcd/ucode/luci.openclaw || fail "missing rpc method: $method"
done
if grep -q 'system_check:' root/usr/share/rpcd/ucode/luci.openclaw; then fail "write probe must not remain in legacy system_check"; fi
grep -Eq '\^\(start\|stop\|restart\|enable\|disable\|restart_gateway\)\$' root/usr/share/rpcd/ucode/luci.openclaw || fail "service action allowlist missing"
grep -Fq -- "-1_all.ipk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must download ipk package"
grep -Fq "oc_safe_openclaw_root" root/usr/libexec/openclaw-rpc.sh || fail "uninstall safety check missing"
grep -q "@tencent-weixin/openclaw-weixin@" root/usr/libexec/openclaw-rpc.sh || fail "wechat install must use the official Weixin plugin package"
grep -q "Local login saved auth" root/usr/libexec/openclaw-rpc.sh || fail "successful Weixin local auth must be recognized"
grep -q "Local login saved auth" root/usr/share/rpcd/ucode/luci.openclaw || fail "Weixin login status must recognize saved local auth"
grep -q '/etc/init.d/openclaw stop >/dev/null 2>&1 || true; /etc/init.d/openclaw start' root/usr/libexec/openclaw-rpc.sh || fail "successful Weixin login must safely restart the procd service"
grep -q 'fix_openclaw_runtime_ownership' root/etc/init.d/openclaw || fail "service must repair root-owned OpenClaw runtime files"
grep -Fq 'ubus call service list ' root/etc/init.d/openclaw || fail "restart must check whether the procd service object exists"
grep -q '^restart() {' root/etc/init.d/openclaw || fail "service must provide an idempotent restart implementation"
runtime_fix_line=$(grep -n '^fix_openclaw_runtime_ownership$' root/etc/init.d/openclaw | head -1 | cut -d: -f1)
entry_check_line=$(grep -n '^local oc_entry$' root/etc/init.d/openclaw | head -1 | cut -d: -f1)
[ -n "$runtime_fix_line" ] && [ -n "$entry_check_line" ] && [ "$runtime_fix_line" -lt "$entry_check_line" ] || fail "runtime ownership must be repaired before entry validation"
final_runtime_fix_line=$(grep -n '^[[:space:]]*fix_openclaw_runtime_ownership$' root/etc/init.d/openclaw | tail -1 | cut -d: -f1)
procd_gateway_line=$(grep -n 'procd_open_instance "gateway"' root/etc/init.d/openclaw | head -1 | cut -d: -f1)
[ -n "$final_runtime_fix_line" ] && [ -n "$procd_gateway_line" ] && [ "$final_runtime_fix_line" -lt "$procd_gateway_line" ] || fail "runtime ownership must be repaired immediately before procd startup"
wechat_login_block=$(sed -n '/^[[:space:]]*wechat-login)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
if printf '%s' "$wechat_login_block" | grep -q '/etc/init.d/openclaw restart'; then fail "Weixin login must avoid noisy restart when the procd object is absent"; fi
grep -q 'start_task /tmp/openclaw-wechat-login "$cmd" /tmp/openclaw-wechat-qrcode.txt' root/usr/libexec/openclaw-rpc.sh || fail "Weixin login must stream directly to its status log"
if grep -q 'mv /tmp/openclaw-wechat-login.log' root/usr/libexec/openclaw-rpc.sh; then fail "Weixin login log must not be moved after task startup"; fi
grep -q 'OC_ACCOUNT_ID' root/usr/libexec/openclaw-rpc.sh || fail "wechat logout must pass selected account safely"
grep -q 'OPENCLAW_OPERATION_LOCK:-/var/lock/openclaw-operation.lock' root/usr/libexec/openclaw-rpc.sh || fail "global operation lock missing"
grep -q 'oc_prepare_backup_restore' root/usr/libexec/openclaw-rpc.sh || fail "safe staged backup restore missing"
if grep -q 'tar -xzf .* -C /' root/usr/libexec/openclaw-rpc.sh; then fail "backup restore must not extract directly to root"; fi
grep -q 'poll.add(L.bind(this.updateStatus, this), 10)' htdocs/luci-static/resources/view/openclaw/overview.js || fail "status polling must use the reduced frequency"
grep -q 'luci-openclaw-status' root/usr/share/rpcd/ucode/luci.openclaw || fail "static status cache missing"
read_acl=$(sed -n '/"read"/,/"write"/p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
write_acl=$(sed -n '/"write"/,$p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
printf '%s' "$read_acl" | grep -q '"system_info"' || fail "system_info must be readable"
if printf '%s' "$read_acl" | grep -q '"gateway_token"\|"install_path_probe"'; then fail "sensitive or mutating methods must not be readable"; fi
printf '%s' "$write_acl" | grep -q '"gateway_token"' || fail "gateway_token must require write ACL"
printf '%s' "$write_acl" | grep -q '"install_path_probe"' || fail "install_path_probe must require write ACL"
if grep -R -q 'csrfToken\|input\[name=token\]' htdocs; then fail "rpc based views must not manage CSRF tokens"; fi
grep -q "openclaw-weixin" root/etc/init.d/openclaw || fail "weixin channel migration missing"

grep -q "var url = 'http://'" htdocs/luci-static/resources/view/openclaw/console.js || fail "console must force HTTP gateway URL"
grep -q "rpc.declare" htdocs/luci-static/resources/openclaw/api.js || fail "views must use LuCI rpc declarations"
grep -q "poll.add" htdocs/luci-static/resources/view/openclaw/overview.js || fail "overview status polling missing"
grep -Fq 'control-ui-*.js' root/etc/init.d/openclaw || fail "iframe patch must cover current control-ui bundles"
if grep -Fq 'ALLOW-FROM *' root/etc/init.d/openclaw; then
	fail "iframe patch must remove X-Frame-Options instead of using unsupported ALLOW-FROM"
fi

grep -q "root/usr/libexec" scripts/build_ipk.sh || fail "ipk script must package shell helpers"
grep -q "root/usr/libexec" scripts/build_run.sh || fail "run script must package shell helpers"
grep -q "openclaw-workspace.sh" Makefile || fail "workspace helper must be packaged"
grep -q "openclaw-backup.sh" Makefile || fail "backup safety helper must be packaged"
grep -q "oc_sync_workspace_tools" root/usr/bin/openclaw-env || fail "setup and upgrade must sync workspace guidance"
grep -q "luci-app-openclaw:openwrt-runtime:start" root/usr/libexec/openclaw-workspace.sh || fail "workspace guidance must use a managed block"
grep -q 'OC_OPERATING_FILE' root/usr/libexec/openclaw-workspace.sh || fail "workspace guidance must inject into OPERATING.md"
if grep -R -E -q 'openclaw gateway (start|stop|restart)' root scripts htdocs; then
	fail "project code must not use unsupported Gateway lifecycle commands"
fi

if grep -R -E -q '59438380|910501|OpenList|openlist' README.md CHANGELOG.md Makefile .github scripts root htdocs; then
	fail "repository documentation and release metadata must not reference removed external publishing sources"
fi
[ ! -e scripts/sync_openlist.sh ] || fail "legacy OpenList sync script must be removed"
[ ! -e scripts/upload_openlist.sh ] || fail "legacy OpenList upload script must be removed"

echo "ok"
