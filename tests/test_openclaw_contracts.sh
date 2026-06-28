#!/bin/sh
set -eu

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

grep -Fq ') </dev/null >/dev/null 2>&1 &' root/usr/libexec/openclaw-rpc.sh || fail "background task shell must detach from rpcd stdio"
grep -Fq 'rm -f "${prefix}.pid"' root/usr/libexec/openclaw-rpc.sh || fail "completed and stale task PID files must be removed"

# 插件版本号唯一来源: Makefile PKG_VERSION (LuCI 惯例)。运行时 VERSION 文件由构建生成, 不入仓库。
_PKG_VER_MK=$(sed -n 's/^PKG_VERSION:=[[:space:]]*//p' Makefile | tr -d '[:space:]')
[ -n "$_PKG_VER_MK" ] || fail "Makefile must declare a non-empty PKG_VERSION"

# 运行时版本号唯一来源: root/usr/bin/openclaw-env (值随脚本声明; CI 与 ucode 后端均直接从此处取值, 故无独立清单文件)。
[ -f root/usr/bin/openclaw-env ] || fail "openclaw-env must exist as the canonical runtime-version source"
_OC_VER=$(sed -n 's/^OC_TESTED_VERSION="\([^"]*\)".*/\1/p' root/usr/bin/openclaw-env)
_NODE_VER=$(sed -n 's/^NODE_VERSION_V2="\([^"]*\)".*/\1/p' root/usr/bin/openclaw-env)
_NODE_MIN_VER=$(sed -n 's/^OC_NODE_MIN_VERSION="${OC_NODE_MIN_VERSION:-\([0-9.]*\)}".*/\1/p' root/usr/bin/openclaw-env)
[ -n "$_OC_VER" ] || fail "openclaw-env must pin OC_TESTED_VERSION"
[ -n "$_NODE_VER" ] || fail "openclaw-env must pin NODE_VERSION_V2"
[ -n "$_NODE_MIN_VER" ] || fail "openclaw-env must pin OC_NODE_MIN_VERSION default"

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
# 唯一真实的跨文件重复: init.d 的最低 Node.js 版本默认值必须与 openclaw-env 一致。
grep -q "OC_NODE_MIN_VERSION=\"\${OC_NODE_MIN_VERSION:-${_NODE_MIN_VER}}\"" root/etc/init.d/openclaw || fail "service minimum Node.js version (init.d) not aligned with openclaw-env (expected ${_NODE_MIN_VER})"
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
for method in status system_info install_path_probe update_check setup_log upgrade_log gateway_token wechat_status wechat_install_log wechat_login_status wechat_update_check service_action setup uninstall upgrade wechat_install wechat_login wechat_logout wechat_upgrade wechat_uninstall secrets_audit; do
	grep -q "${method}:" root/usr/share/rpcd/ucode/luci.openclaw || fail "missing rpc method: $method"
done

# 备份恢复功能已整体移除: 不得有任何 backup action/方法/helper 残留。
if grep -qi 'backup' root/usr/libexec/openclaw-rpc.sh root/usr/share/rpcd/ucode/luci.openclaw root/usr/share/rpcd/acl.d/luci-app-openclaw.json htdocs/luci-static/resources/openclaw/api.js htdocs/luci-static/resources/view/openclaw/overview.js; then
	fail "backup/restore feature must be fully removed (no backup references should remain)"
fi
[ ! -e root/usr/libexec/openclaw-backup.sh ] || fail "backup helper must be removed"
if grep -q 'system_check:' root/usr/share/rpcd/ucode/luci.openclaw; then fail "write probe must not remain in legacy system_check"; fi
grep -Eq '\^\(start\|stop\|restart\|enable\|disable\|restart_gateway\)\$' root/usr/share/rpcd/ucode/luci.openclaw || fail "service action allowlist missing"
grep -Fq -- "-1_all.ipk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must download ipk package"
grep -Fq "oc_safe_openclaw_root" root/usr/libexec/openclaw-rpc.sh || fail "uninstall safety check missing"
grep -q "@tencent-weixin/openclaw-weixin@" root/usr/libexec/openclaw-rpc.sh || fail "wechat install must use the official Weixin plugin package"
grep -q "Local login saved auth" root/usr/libexec/openclaw-rpc.sh || fail "successful Weixin local auth must be recognized"
grep -q "Local login saved auth" root/usr/share/rpcd/ucode/luci.openclaw || fail "Weixin login status must recognize saved local auth"
grep -q '/etc/init.d/openclaw stop >/dev/null 2>&1 || true; /etc/init.d/openclaw start' root/usr/libexec/openclaw-rpc.sh || fail "successful Weixin login must safely restart the procd service"
grep -q 'fix_openclaw_runtime_ownership' root/etc/init.d/openclaw || fail "service must repair root-owned OpenClaw runtime files"
# 网关令牌解耦: 始终用 --token 显式启动 (env 赢过 openclaw.json 的引用/明文),
# 使 LuCI 控制台对用户在 OpenClaw 内迁移/抹除 gateway.auth.token 免疫。
grep -q 'gateway run.*--token' root/etc/init.d/openclaw || fail "gateway must launch with explicit --token to decouple auth from config"
if grep -q 'gateway\.auth\.token=process\.env\.OC_SYNC_TOKEN' root/etc/init.d/openclaw; then
	fail "sync must not force plaintext gateway.auth.token into openclaw.json"
fi
if grep -q '_sync_token_after_doctor\|JSON -> UCI' root/etc/init.d/openclaw; then
	fail "must not pull gateway token from JSON back into UCI"
fi
grep -q 'OPENCLAW_GATEWAY_TOKEN' root/usr/libexec/openclaw-rpc.sh || fail "CLI must authenticate via OPENCLAW_GATEWAY_TOKEN env"
# 同步网关 CLI 经 ucode popen 跑在 rpcd uloop 上, 必须有 timeout 上限, 否则网关挂死会锁死整个 LuCI。
grep -Eq 'timeout [0-9]+ su -s /bin/sh openclaw' root/usr/libexec/openclaw-rpc.sh || fail "oc_cli_run must bound gateway CLI with timeout to avoid rpcd lockup"
# 设置活跃模型必须用快速直写(model.primary), 不得同步跑会阻塞 rpcd 的 'models set'(连慢网关)或 'config patch'(实测 6s)。
if grep -q 'oc_cli_run "models set' root/usr/libexec/openclaw-rpc.sh; then fail "model set must not block on slow 'openclaw models set'"; fi
grep -A10 'cli-models-set)' root/usr/libexec/openclaw-rpc.sh | grep -q 'model.primary=process.env' || fail "cli-models-set must set primary via fast direct write"
grep -q 'SecretRef\|密钥已托管' root/usr/share/rpcd/ucode/luci.openclaw || fail "telegram_status must handle SecretRef botToken without calling getMe on a ref"
# web-pty 根终端退役: 消除 openclaw->root 提权(世界可读 pty_token + root 终端)及其暴露面。
if grep -q 'web-pty.js' Makefile scripts/build_ipk.sh scripts/build_run.sh; then fail "retired web-pty must not be packaged"; fi
if grep -Eq 'oc-config\.sh|oc-config-interactive|oc-menu-engine' Makefile; then fail "retired config-menu cluster must not be packaged"; fi
[ ! -e root/usr/share/openclaw/web-pty.js ] || fail "web-pty.js source must be removed"
[ ! -e root/usr/share/openclaw/oc-config.sh ] || fail "oc-config.sh source must be removed"
[ ! -e root/usr/share/openclaw/ui ] || fail "vendored web-pty ui/ must be removed"
if grep -q 'procd_open_instance "pty"' root/etc/init.d/openclaw; then fail "pty service instance must be retired"; fi
# init.d/ucode 不得再生成或读取 pty_token; uci-defaults 可引用它(仅为清理旧安装的残留)。
if grep -q 'pty_token' root/etc/init.d/openclaw root/usr/share/rpcd/ucode/luci.openclaw; then fail "pty_token must not be generated/read after retirement"; fi
grep -q 'delete openclaw.main.pty_token' root/etc/uci-defaults/99-openclaw || fail "uci-defaults must scrub legacy pty_token on upgrade"
# allowInsecureAuth 仅放宽 localhost, 被 dangerouslyDisableDeviceAuth 覆盖 -> 不应再强制写 true(减少一个安全降级)。
if grep -Eq 'allowInsecureAuth[^;]*true' root/etc/init.d/openclaw root/usr/bin/openclaw-env; then fail "redundant controlUi.allowInsecureAuth must not be force-enabled"; fi
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
grep -q 'poll.add(L.bind(this.updateStatus, this), 10)' htdocs/luci-static/resources/view/openclaw/overview.js || fail "status polling must use the reduced frequency"
grep -q 'luci-openclaw-status' root/usr/share/rpcd/ucode/luci.openclaw || fail "static status cache missing"
read_acl=$(sed -n '/"read"/,/"write"/p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
write_acl=$(sed -n '/"write"/,$p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
printf '%s' "$read_acl" | grep -q '"system_info"' || fail "system_info must be readable"
printf '%s' "$read_acl" | grep -q '"secrets_audit"' || fail "secrets_audit must be readable"
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
# 安装器必须在 postinst/安装末尾 reload rpcd, 否则 luci.openclaw 对象不注册 -> 页面 "Object not found"/升级卡死。
if grep -q '请自行执行: /etc/init.d/rpcd reload' scripts/build_ipk.sh; then fail "ipk postinst must reload rpcd, not defer it to the frontend"; fi
if grep -q '由 LuCI 前端在安装成功后自动触发' scripts/build_run.sh; then fail "run installer must reload rpcd, not defer it to the frontend"; fi
grep -q '/etc/init.d/rpcd reload' scripts/build_run.sh || fail "run installer must reload rpcd after install"
# 卸载插件(opkg remove)须清理 conffile 本体/opkg 副本/备份残留。
grep -q 'rm -f /etc/config/openclaw /etc/config/openclaw-opkg' scripts/build_ipk.sh || fail "ipk postrm must purge config artifacts on full removal"
# postrm 须用 opkg 的 PKG_UPGRADE 判定升级/卸载, 而非 dpkg 的 $1=0(opkg 不传, 会导致清理永不执行)。
if grep -q '\[ "$1" = "0" \]' scripts/build_ipk.sh; then fail "postrm must guard with PKG_UPGRADE, not dpkg-style \$1=0"; fi
grep -q 'PKG_UPGRADE' scripts/build_ipk.sh || fail "ipk postrm must use PKG_UPGRADE to detect upgrade vs removal"
# 卸载环境(uninstall-task)只卸运行时、保留配置(仅关自启), 不得删除 /etc/config/openclaw。
if grep -A12 'uninstall-task)' root/usr/libexec/openclaw-rpc.sh | grep -q 'rm -f /etc/config/openclaw'; then fail "uninstall-task must keep /etc/config/openclaw (env uninstall only removes runtime)"; fi
grep -A12 'uninstall-task)' root/usr/libexec/openclaw-rpc.sh | grep -q "openclaw.main.enabled='0'" || fail "uninstall-task must disable autostart while keeping config"
grep -q "openclaw-workspace.sh" Makefile || fail "workspace helper must be packaged"
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
