#!/bin/sh
set -eu

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

grep -Fq ') </dev/null >/dev/null 2>&1 &' root/usr/libexec/openclaw-rpc.sh || fail "background task shell must detach from rpcd stdio"
grep -Fq 'nohup "$ttyd_bin" -p "$port" -i br-lan -o -W -u "$uid"' root/usr/libexec/openclaw-rpc.sh || fail "wizard ttyd must allow client keyboard input (-W)"
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
# 允许用户驱动的 openclaw-weixin 渠道生命周期，以及经待确认状态复核的能力确认；但仍禁止
# 直接改动插件 allow/deny/entries/installs 策略或普通 enable/disable 其它插件。
if grep -R -n -E --exclude='*.min.js' \
	'plugins\.(allow|deny|entries|installs)|plugins\[.(allow|deny|entries|installs)|plugins[[:space:]]+(enable|disable)' \
	root/etc root/usr/bin root/usr/libexec root/usr/share/openclaw 2>/dev/null \
	| grep -v 'openclaw-weixin' | grep -v -- '--accept-capabilities' | grep -q .; then
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
for method in status system_info install_path_probe update_check setup_log upgrade_log gateway_token wechat_status wechat_install_log wechat_login_status wechat_update_check service_action setup uninstall upgrade wechat_install wechat_login wechat_logout wechat_upgrade wechat_uninstall secrets_audit plugin_capability_check plugin_capability_accept plugin_capability_log console_device_pairing_list console_device_pairing_approve console_device_pairing_reject; do
	grep -q "${method}:" root/usr/share/rpcd/ucode/luci.openclaw || fail "missing rpc method: $method"
done
grep -q 'function semver_gt' root/usr/share/rpcd/ucode/luci.openclaw || fail "plugin update check must compare semantic versions"
grep -q 'plugin_has_update: !!latest && semver_gt(latest, current)' root/usr/share/rpcd/ucode/luci.openclaw || fail "plugin update check must only offer newer versions"
if grep -q 'plugin_has_update: !!latest && current != latest' root/usr/share/rpcd/ucode/luci.openclaw; then
	fail "plugin update check must not treat any version mismatch as an upgrade"
fi
# OpenClaw 核心与插件检查在实机上合计可超过 LuCI 默认 20 秒 RPC 时限，必须后台执行并轮询结果。
grep -q 'env_upgrade_check_start:.*env-upgrade-check' root/usr/share/rpcd/ucode/luci.openclaw || fail "runtime update check must start as a background task"
grep -q "task_status('/tmp/openclaw-env-check')" root/usr/share/rpcd/ucode/luci.openclaw || fail "runtime update check status must be polled from task files"
grep -q 'start_task /tmp/openclaw-env-check' root/usr/libexec/openclaw-rpc.sh || fail "runtime update check must not block rpcd"
if sed -n '/function env_upgrade_check_status()/,/^}/p' root/usr/share/rpcd/ucode/luci.openclaw | grep -q "run('/usr/bin/openclaw"; then
	fail "runtime update status RPC must not execute network CLI commands synchronously"
fi
grep -q "envUpgradeCheckStart: call('env_upgrade_check_start')" htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose background update-check startup"
grep -q 'api.envUpgradeCheckStart()' htdocs/luci-static/resources/view/openclaw/overview.js || fail "runtime update UI must start the background check before polling"
sed -n '/"write"/,$p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json | grep -q '"env_upgrade_check_start"' || fail "runtime update-check startup must require write ACL"

# 备份恢复功能已整体移除: 不得有任何 backup action/方法/helper 残留。
if grep -qi 'backup' root/usr/libexec/openclaw-rpc.sh root/usr/share/rpcd/ucode/luci.openclaw root/usr/share/rpcd/acl.d/luci-app-openclaw.json htdocs/luci-static/resources/openclaw/api.js htdocs/luci-static/resources/view/openclaw/overview.js; then
	fail "backup/restore feature must be fully removed (no backup references should remain)"
fi
[ ! -e root/usr/libexec/openclaw-backup.sh ] || fail "backup helper must be removed"
if grep -q 'OC_BACKUP_DIR\|oc_normalize_backup_dir' root/usr/libexec/openclaw-paths.sh; then
	fail "retired backup path state and normalizer must be removed"
fi
if grep -q '备份/恢复\|备份与恢复\|升级与备份' README.md; then
	fail "README must not advertise the retired backup/restore feature"
fi
[ -f README_EN.md ] || fail "English project documentation is missing"
grep -Fq '[English](README_EN.md)' README.md || fail "Chinese README must link to the English documentation"
grep -Fq '[简体中文](README.md)' README_EN.md || fail "English README must link back to the Chinese documentation"
if grep -qi 'backup / restore\\|backup and restore' README_EN.md; then
	fail "English README must not advertise the retired backup/restore feature"
fi
if grep -q 'system_check:' root/usr/share/rpcd/ucode/luci.openclaw; then fail "write probe must not remain in legacy system_check"; fi
grep -Eq '\^\(start\|stop\|restart\|enable\|disable\|restart_gateway\)\$' root/usr/share/rpcd/ucode/luci.openclaw || fail "service action allowlist missing"
grep -Fq -- "-1_all.ipk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must support opkg/ipk package"
grep -Fq -- "-r1.apk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must support apk package"
grep -Fq -- "luci-i18n-openclaw-zh-cn_\${version}-1_all.ipk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must include split opkg/ipk i18n package"
grep -Fq -- "luci-i18n-openclaw-zh-cn-\${version}-r1.apk" root/usr/libexec/openclaw-rpc.sh || fail "upgrade must include split apk i18n package"
grep -q '/usr/share/openclaw/PACKAGE_FORMAT' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must read the build-stamped package format"
grep -q '\[ "$package_format" = "apk" \]' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must honor PACKAGE_FORMAT=apk"
grep -q '\[ "$package_format" = "ipk" \]' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must honor PACKAGE_FORMAT=ipk"
grep -q 'command -v apk' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must detect apk package manager"
grep -q 'apk add --allow-untrusted' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must install apk package with apk"
grep -q 'opkg install --force-reinstall' root/usr/libexec/openclaw-rpc.sh || fail "upgrade must install ipk package with opkg"
# 网页内升级必须在调用包管理器前抓取 UCI，并在安装完成后恢复；否则包管理器安装流程
# 在部分版本上会把 install_path/token 等用户设置覆盖为包内默认值。
upgrade_block=$(sed -n '/^[[:space:]]*upgrade)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
printf '%s' "$upgrade_block" | grep -q 'oip=$(uci -q get openclaw.main.install_path' || fail "plugin upgrade must snapshot the configured install path"
printf '%s' "$upgrade_block" | grep -q 'uci commit openclaw' || fail "plugin upgrade must restore and commit the UCI snapshot"
if printf '%s' "$upgrade_block" | grep -q 'token=$(oc_quote "$otok")' &&
	! printf '%s' "$upgrade_block" | grep -q '\[ -z "$otok" \]'; then
	fail "plugin upgrade must not restore an empty token over the token generated by uci-defaults"
fi
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
# doctor 迁移与修复必须始终以运行用户执行；2026.8.1 的插件属主校验会记住调用 UID，root 运行会污染可信属主判断。
migration_block=$(sed -n '/_run_config_migration()/,/^[[:space:]]*}/p' root/etc/init.d/openclaw)
printf '%s' "$migration_block" | grep -q '/usr/bin/openclaw doctor --fix --non-interactive' || fail "version migration doctor must use the privilege-dropping OpenClaw wrapper"
if printf '%s' "$migration_block" | grep -q '"$NODE_BIN" "$oc_entry" doctor'; then fail "version migration doctor must not run directly as root"; fi
marker_line=$(printf '%s' "$migration_block" | grep -n 'echo "$current_ver" > "$version_marker"' | cut -d: -f1)
success_line=$(printf '%s' "$migration_block" | grep -n 'if /usr/bin/openclaw doctor' | cut -d: -f1)
[ -n "$marker_line" ] && [ -n "$success_line" ] && [ "$marker_line" -gt "$success_line" ] || fail "migration version marker must only be written inside the success branch"
doctor_fix_block=$(sed -n '/^[[:space:]]*cli-doctor-fix)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
printf '%s' "$doctor_fix_block" | grep -q '/etc/init.d/openclaw stop' || fail "doctor repair must stop the managed gateway before shared-state migration"
printf '%s' "$doctor_fix_block" | grep -q "ubus call service delete.*openclaw" || fail "doctor repair must remove the respawning procd instance before waiting"
printf '%s' "$doctor_fix_block" | grep -q 'wait_oc_exit' || fail "doctor repair must wait for Gateway SQLite ownership to be released"
printf '%s' "$doctor_fix_block" | grep -q 'kill -0.*oc_pid' || fail "doctor repair must verify the managed Gateway process has exited"
printf '%s' "$doctor_fix_block" | grep -q "trap 'restore_oc; exit 130' INT TERM" || fail "doctor wait phase must restore on cancellation without an inherited EXIT trap"
printf '%s' "$doctor_fix_block" | grep -q "trap 'restore_oc' EXIT INT TERM" || fail "doctor repair must restore gateway state on success, failure, or cancellation"
printf '%s' "$doctor_fix_block" | grep -q 'restore_gateway\|wait_gateway_exit\|was_running' && fail "doctor task command must not match the broad gateway process regex"
printf '%s' "$doctor_fix_block" | grep -q '/usr/bin/openclaw doctor --fix --non-interactive' || fail "doctor repair must run through the privilege-dropping wrapper"
# 设置活跃模型必须用快速直写(model.primary), 不得同步跑会阻塞 rpcd 的 'models set'(连慢网关)或 'config patch'(实测 6s)。
if grep -q 'oc_cli_run "models set' root/usr/libexec/openclaw-rpc.sh; then fail "model set must not block on slow 'openclaw models set'"; fi
grep -A10 'cli-models-set)' root/usr/libexec/openclaw-rpc.sh | grep -q 'model.primary=process.env' || fail "cli-models-set must set primary via fast direct write"
grep -q 'SecretRef\|密钥已托管' root/usr/share/rpcd/ucode/luci.openclaw || fail "telegram_status must handle SecretRef botToken without calling getMe on a ref"
# 插件能力扩大属于安全决策：只读发现与写入确认必须分离，服务端重查待确认状态后才能授权。
capability_check_block=$(sed -n '/^[[:space:]]*plugin-capability-check)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
capability_accept_block=$(sed -n '/^[[:space:]]*plugin-capability-accept)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
printf '%s' "$capability_check_block" | grep -q 'plugins inspect --all --json' || fail "capability check must use OpenClaw machine-readable plugin inspection"
printf '%s' "$capability_check_block" | grep -q 'plugin?.enabled !== true' || fail "capability check must ignore disabled plugins"
printf '%s' "$capability_check_block" | grep -q 'requires capability consent' || fail "capability check must only report plugins awaiting consent"
printf '%s' "$capability_accept_block" | grep -q 'plugin-capability-check' || fail "capability acceptance must recheck pending state server-side"
printf '%s' "$capability_accept_block" | grep -q -- '--accept-capabilities' || fail "capability acceptance must use the official consent flag"
printf '%s' "$capability_accept_block" | grep -q '/etc/init.d/openclaw restart' || fail "capability acceptance must apply all selections with one gateway restart"
grep -q "pluginCapabilityCheck: call('plugin_capability_check')" htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose capability checks"
grep -q "pluginCapabilityAccept: call('plugin_capability_accept'" htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose explicit capability acceptance"
grep -q 'plugin_capability_check.*plugin_capability_log' root/usr/share/rpcd/acl.d/luci-app-openclaw.json || fail "capability check and task log must have read ACL"
grep -q 'plugin_capability_accept' root/usr/share/rpcd/acl.d/luci-app-openclaw.json || fail "capability acceptance must require write ACL"
# 2026.8.1 将频道配对迁入共享 SQLite；LuCI 不得继续只依赖已被迁移删除的 legacy allowFrom JSON。
telegram_pairing_block=$(sed -n '/^[[:space:]]*telegram-paired-ids)/,/^[[:space:]]*;;/p' root/usr/libexec/openclaw-rpc.sh)
printf '%s' "$telegram_pairing_block" | grep -q 'channel_pairing_allow_entries' || fail "Telegram status must read migrated pairing entries from shared SQLite"
printf '%s' "$telegram_pairing_block" | grep -q 'readOnly: true' || fail "Telegram pairing status must open shared SQLite read-only"
grep -q 'telegram-paired-ids' root/usr/share/rpcd/ucode/luci.openclaw || fail "LuCI Telegram status must use the SQLite pairing reader"
grep -q 'pairing_state?.available == true' root/usr/share/rpcd/ucode/luci.openclaw || fail "LuCI Telegram status must only fall back when SQLite is unavailable"
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
# 2026.8.1 已废弃 dangerouslyDisableDeviceAuth；新安装不得再写入，启动时应清理旧值。
if grep -Eq 'allowInsecureAuth[^;]*true' root/etc/init.d/openclaw root/usr/bin/openclaw-env; then fail "redundant controlUi.allowInsecureAuth must not be force-enabled"; fi
if grep -Eq 'dangerouslyDisableDeviceAuth[^;]*=[[:space:]]*true' root/etc/init.d/openclaw root/usr/bin/openclaw-env; then fail "retired controlUi.dangerouslyDisableDeviceAuth must not be written"; fi
grep -q 'delete d.gateway.controlUi.dangerouslyDisableDeviceAuth' root/etc/init.d/openclaw || fail "service must scrub the retired device-auth bypass"
# 控制台配对必须由后端用 UCI Token 调官方 devices CLI，只返回白名单元数据，批准/拒绝要求写 ACL。
pairing_shell=$(sed -n '/^[[:space:]]*console-device-pairing-list)/,/^[[:space:]]*plugin-capability-check)/p' root/usr/libexec/openclaw-rpc.sh)
printf '%s' "$pairing_shell" | grep -q 'devices list --json' || fail "console pairing must query the official devices CLI"
printf '%s' "$pairing_shell" | grep -q 'devices $device_action' || fail "console pairing must approve/reject through the official devices CLI"
printf '%s' "$pairing_shell" | grep -q 'Invalid device pairing request ID' || fail "console pairing request IDs must be validated server-side"
grep -q 'oc_cli_gateway_run.*--token' root/usr/libexec/openclaw-rpc.sh || grep -A8 '^oc_cli_gateway_run()' root/usr/libexec/openclaw-rpc.sh | grep -q -- '--token' || fail "console pairing CLI must authenticate with the UCI gateway token"
grep -q 'consoleDevicePairingList' htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose console pairing discovery"
grep -q 'consoleDevicePairingApprove' htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose console pairing approval"
grep -q 'consoleDevicePairingReject' htdocs/luci-static/resources/openclaw/api.js || fail "frontend API must expose console pairing rejection"
grep -q 'poll.add(this._pairingPoll, 15)' htdocs/luci-static/resources/view/openclaw/console.js || fail "console pairing requests must be polled at a router-safe interval"
grep -q "ocui.confirm(question" htdocs/luci-static/resources/view/openclaw/console.js || fail "console pairing changes must require explicit confirmation"
read_acl_pair=$(sed -n '/"read"/,/"write"/p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
write_acl_pair=$(sed -n '/"write"/,$p' root/usr/share/rpcd/acl.d/luci-app-openclaw.json)
printf '%s' "$read_acl_pair" | grep -q 'console_device_pairing_list' || fail "console pairing discovery must have read ACL"
if printf '%s' "$read_acl_pair" | grep -q 'console_device_pairing_approve\|console_device_pairing_reject'; then fail "console pairing mutations must not have read ACL"; fi
printf '%s' "$write_acl_pair" | grep -q 'console_device_pairing_approve' || fail "console pairing approval must require write ACL"
printf '%s' "$write_acl_pair" | grep -q 'console_device_pairing_reject' || fail "console pairing rejection must require write ACL"
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
# 手工 opkg 升级同样必须保留配置；prerm 创建的一次性快照由 postinst 消费并删除。
grep -q 'cp /etc/config/openclaw /etc/config/openclaw.pre-upgrade.bak' scripts/build_ipk.sh || fail "ipk prerm must snapshot config before upgrade"
grep -q 'elif \[ -f /etc/config/openclaw.pre-upgrade.bak \]' scripts/build_ipk.sh || fail "ipk postinst must restore the pre-upgrade config snapshot"
grep -q 'rm -f /etc/config/openclaw.pre-upgrade.bak' scripts/build_ipk.sh || fail "ipk postinst must remove the consumed config snapshot"
grep -Fq 'uci set "openclaw.main.$1=$2"' scripts/build_ipk.sh || fail "ipk postinst must restore config values through uci without sed interpolation"
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
