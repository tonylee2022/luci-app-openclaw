#!/bin/sh
# 由 procd 管理启停，官方 CLI 负责候选验证、包替换与迁移。
set -u

oc_update_cli() {
	"${OPENCLAW_UPDATE_CLI:-/usr/bin/openclaw}" "$@"
}

oc_update_service() {
	"${OPENCLAW_UPDATE_SERVICE:-/etc/init.d/openclaw}" "$@"
}

oc_update_running() {
	ubus call service list '{"name":"openclaw"}' | "$NODE_BASE/bin/node" -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
try { const d=JSON.parse(s); console.log(Object.values(d.openclaw?.instances||{}).some(v=>v.running===true)?"yes":"no"); }
catch { process.exitCode=1; }
});'
}

oc_update_receipt() {
	# 检查器以包属主运行；不改写回执和租约数据库。
	su -s /bin/sh -c 'exec "$@"' -- openclaw sh \
		env "HOME=$OC_HOME" "TMPDIR=$OC_TMP" \
		"$NODE_BASE/bin/node" /usr/libexec/openclaw-update-receipt.mjs \
		"$OC_GLOBAL/lib/node_modules/openclaw" "$@"
}

oc_update_preview() {
	# 官方预演使用同一目标与停服策略；拒绝或未知安装方式都不能进入停服。
	if [ "$#" -gt 0 ]; then
		update_preview_json=$(oc_update_cli update --dry-run --no-restart --json --tag "$1") || return 1
	else
		update_preview_json=$(oc_update_cli update --dry-run --no-restart --json) || return 1
	fi
	printf '%s' "$update_preview_json" | "$NODE_BASE/bin/node" -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
try {
 const d=JSON.parse(s);
 if(d.dryRun!==true || !["npm","pnpm","bun"].includes(d.mode))process.exitCode=1;
 else console.log("Official update preflight passed");
}catch { process.exitCode=1; }
});'
}

oc_update_health() {
	# 只检查本机网关，不输出健康响应中的渠道和用户资料。
	update_health_json=$(timeout 15 "${OPENCLAW_UPDATE_CLI:-/usr/bin/openclaw}" health --json 2>/dev/null) || return 1
	printf '%s' "$update_health_json" | "$NODE_BASE/bin/node" -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
try { if(JSON.parse(s).ok!==true)process.exitCode=1; }catch { process.exitCode=1; }
});'
}

oc_update_restore() {
	[ "$update_was_running" = yes ] || return 0
	# 官方仍保留操作所有权时，不能仅因 CLI 已退出就启动服务。
	if ! oc_update_receipt --check-only; then
		echo "Gateway recovery deferred: unresolved update custody; preserve artifacts and inspect the update report" >&2
		return 1
	fi
	echo "Restoring OpenClaw service through procd..."
	oc_update_service start || return 1
	update_health_deadline=$(( $(date +%s) + ${OPENCLAW_UPDATE_HEALTH_WAIT:-180} ))
	while :; do
		if oc_update_health; then
			echo "Gateway recovery: healthy"
			return 0
		fi
		[ "$(date +%s)" -lt "$update_health_deadline" ] || break
		sleep 3
	done
	echo "Gateway recovery: failed; inspect OpenClaw service logs" >&2
	return 1
}

oc_update_cleanup() {
	# 恢复流程结束后以 root 读取 /proc；清理结果写入现有 LuCI 升级日志。
	update_cleanup_json=$("$NODE_BASE/bin/node" /usr/libexec/openclaw-update-cleanup.mjs \
		"$OC_GLOBAL/lib/node_modules/openclaw" "$OC_TMP")
	update_cleanup_rc=$?
	if [ -n "$update_cleanup_json" ]; then
		printf 'Retained runtime cleanup: %s\n' "$update_cleanup_json"
	else
		echo 'Retained runtime cleanup: {"status":"warning","removed":[],"retained":[],"reason":"cleanup helper returned no result"}'
	fi
	if [ "$update_cleanup_rc" -ne 0 ]; then
		echo "Runtime cleanup warning: helper exited $update_cleanup_rc; update outcome is preserved" >&2
	fi
	return 0
}

oc_update_finish() {
	update_exit=$?
	trap - EXIT INT TERM
	if [ "$update_restore_needed" = yes ]; then
		if ! oc_update_restore; then
			[ "$update_exit" -ne 0 ] || update_exit=1
		fi
	fi
	# 仅在官方更新实际运行过之后清理；仍持有 LuCI 操作锁。
	if [ "${update_attempted:-no}" = yes ]; then
		oc_update_cleanup || echo "Runtime cleanup warning: recovery and update outcome are preserved" >&2
	fi
	[ "$update_owns_lock" = no ] || release_operation_lock
	rm -f /tmp/luci-openclaw-status.*
	exit "$update_exit"
}

oc_update_run() {
	update_was_running=$(oc_update_running) || return 1
	case "$update_was_running" in yes|no) ;; *) return 1 ;; esac
	# 在停服前拒绝未完成或无法确认的回执，减少无效停机。
	oc_update_receipt || return 1
	oc_update_preview "$@" || return 1
	update_before=$(oc_update_cli --version) || return 1
	echo "Installed before update: $update_before"
	update_restore_needed=yes
	if ! oc_update_service stop; then
		echo "Failed to stop OpenClaw; update was not started" >&2
		return 1
	fi
	# procd 的 stop 异步完成，等待它释放进程后才能迁移数据库。
	update_stop_deadline=$(( $(date +%s) + ${OPENCLAW_UPDATE_STOP_WAIT:-60} ))
	while :; do
		update_running=$(oc_update_running) || return 1
		case "$update_running" in
			no) break ;;
			yes) ;;
			*) return 1 ;;
		esac
		if [ "$(date +%s)" -ge "$update_stop_deadline" ]; then
			echo "OpenClaw is still running after stop timeout; update was not started" >&2
			return 1
		fi
		sleep 2
	done
	# 历史备份可能含失效软链接；修正链接本身，避免越过运行目录修改目标。
	chown -hR openclaw:openclaw "$OC_HOME" || return 1
	update_attempted=yes
	if [ "$#" -gt 0 ]; then
		oc_update_cli update --yes --no-restart --tag "$1"
	else
		oc_update_cli update --yes --no-restart
	fi
	update_rc=$?
	if [ "$update_rc" -ne 0 ]; then
		echo "OpenClaw update failed (exit $update_rc); service recovery does not imply upgrade success" >&2
		return "$update_rc"
	fi
	update_after=$(oc_update_cli --version) || return 1
	echo "Installed after update: $update_after"
	echo "Package update completed; gateway verification follows if previously running"
}

[ "${OPENCLAW_UPDATE_LIBRARY_ONLY:-0}" != 1 ] || return 0
[ "$(id -u)" = 0 ] || { echo "Run OpenClaw upgrade as root through LuCI or procd" >&2; exit 1; }
OPENCLAW_RPC_LIBRARY_ONLY=1
. /usr/libexec/openclaw-rpc.sh
oc_load_paths "${OPENCLAW_INSTALL_PATH:-$(uci -q get openclaw.main.install_path || echo /opt)}" || fail "Invalid install path"
[ -x "$NODE_BASE/bin/node" ] || fail "OpenClaw Node.js is not installed"
id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
update_owns_lock=no
if [ "${OPENCLAW_UPDATE_LOCK_HELD:-0}" != 1 ]; then
	acquire_operation_lock openclaw-env-upgrade
	update_owns_lock=yes
fi
update_restore_needed=no
update_attempted=no
trap oc_update_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# 凭据仅用于本机健康检查，不写入日志或命令参数。
OPENCLAW_GATEWAY_TOKEN=$(uci -q get openclaw.main.token 2>/dev/null || true)
export OPENCLAW_GATEWAY_TOKEN
oc_update_run "$@"
exit $?
