#!/bin/sh
set -eu
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
TEST_NODE_BASE=$(dirname "$(dirname "$(command -v node)")")
export TEST_ROOT TEST_NODE_BASE

run_case() {
	CASE_NAME="$1" EXPECTED_RC="$2" export CASE_NAME EXPECTED_RC
	case_dir="$TEST_ROOT/$1"
	mkdir "$case_dir"
	case_rc=0
	sh -c '
OPENCLAW_UPDATE_LIBRARY_ONLY=1
. ./root/usr/libexec/openclaw-update.sh
events="$TEST_ROOT/$CASE_NAME/events"
event() { echo "$*" >> "$events"; }
update_was_running=no
update_restore_needed=no
update_owns_lock=yes
OC_HOME="$TEST_ROOT/$CASE_NAME"
NODE_BASE="$TEST_NODE_BASE"
OPENCLAW_UPDATE_HEALTH_WAIT=0
if [ "$CASE_NAME" = still-running ]; then OPENCLAW_UPDATE_STOP_WAIT=0; fi
oc_update_running() {
	if [ "$CASE_NAME" = stopped ] || [ -f "$OC_HOME/stopped" ]; then echo no; else echo yes; fi
}
oc_update_receipt() {
	event "receipt $*"
	[ "$CASE_NAME" != preflight-fail ] || return 1
	if [ "$CASE_NAME" = unresolved ] && [ "$#" -gt 0 ]; then return 1; fi
}
oc_update_service() {
	event "service $*"
	if [ "$1" = stop ]; then
		[ "$CASE_NAME" != stop-fail ] || return 1
		case "$CASE_NAME" in still-running|delayed-stop) ;; *) touch "$OC_HOME/stopped" ;; esac
	fi
}
oc_update_cli() {
	if [ "$1" = --version ]; then echo "OpenClaw test-version"; return 0; fi
	event "cli $*"
	if [ "${2:-}" = --dry-run ]; then
		[ "$CASE_NAME" != preview-fail ] || return 1
		if [ "$CASE_NAME" = preview-invalid ]; then echo "invalid";
		elif [ "$CASE_NAME" = preview-skipped ]; then echo "{\"mode\":\"unknown\"}";
		else echo "{\"dryRun\":true,\"mode\":\"npm\"}"; fi
		return 0
	fi
	case "$CASE_NAME" in update-fail|update-cleanup-fail|unresolved) return 42 ;; signal) kill -TERM $$ ;; esac
}
chown() { event "ownership $*"; }
sleep() { event wait; [ "$CASE_NAME" != delayed-stop ] || touch "$OC_HOME/stopped"; }
rm() { event cache-clear; }
release_operation_lock() { event unlock; }
oc_update_cleanup() {
	event cleanup
	if [ "$CASE_NAME" = cleanup-fail ] || [ "$CASE_NAME" = update-cleanup-fail ]; then return 1; fi
	echo "Retained runtime cleanup: {\"status\":\"ok\",\"removed\":[],\"retained\":[]}"
}
oc_update_health() { event health; [ "$CASE_NAME" != health-fail ]; }
trap oc_update_finish EXIT
trap "exit 143" TERM
oc_update_run latest
exit $?
' > "$case_dir/log" 2>&1 || case_rc=$?
	[ "$case_rc" = "$2" ] || { cat "$case_dir/log"; echo "FAIL: $1 exited $case_rc, expected $2"; exit 1; }
	grep -q '^unlock$' "$case_dir/events" || { echo "FAIL: lock not released for $1"; exit 1; }
}

run_case success 0
grep -q '^cli update --yes --no-restart --tag latest$' "$TEST_ROOT/success/events"
grep -q '^service start$' "$TEST_ROOT/success/events"
grep -q '^health$' "$TEST_ROOT/success/events"
grep -q '^ownership -hR openclaw:openclaw ' "$TEST_ROOT/success/events"
# 清理在恢复和健康检查之后、释放操作锁之前，且不会改写升级结果。
awk '/^health$/{healthy=1} /^cleanup$/{if(!healthy)exit 1; cleaned=1} /^unlock$/{if(!cleaned)exit 1}' "$TEST_ROOT/success/events"
grep -q '^Retained runtime cleanup: ' "$TEST_ROOT/success/log"
run_case cleanup-fail 0
run_case update-cleanup-fail 42
grep -q '^service start$' "$TEST_ROOT/cleanup-fail/events"
run_case update-fail 42
grep -q '^service start$' "$TEST_ROOT/update-fail/events"
grep -q 'service recovery does not imply upgrade success' "$TEST_ROOT/update-fail/log"
run_case health-fail 1
run_case preflight-fail 1
! grep -q '^service ' "$TEST_ROOT/preflight-fail/events"
! grep -q '^cleanup$' "$TEST_ROOT/preflight-fail/events"
for refused_preview in preview-fail preview-invalid preview-skipped; do
	run_case "$refused_preview" 1
	! grep -q '^service ' "$TEST_ROOT/$refused_preview/events"
done
grep -q '^cli update --dry-run --no-restart --json --tag latest$' "$TEST_ROOT/success/events"
# 必须先通过官方预演再停服。
awk '/^cli update --dry-run/{preview=1} /^service stop$/{if(!preview)exit 1; stopped=1} END{if(!stopped)exit 1}' "$TEST_ROOT/success/events"
run_case stopped 0
! grep -q '^service start$' "$TEST_ROOT/stopped/events"
run_case stop-fail 1
! grep -q '^cli update --yes' "$TEST_ROOT/stop-fail/events"
run_case still-running 1
! grep -q '^cli update --yes' "$TEST_ROOT/still-running/events"
run_case delayed-stop 0
grep -q '^wait$' "$TEST_ROOT/delayed-stop/events"
grep -q '^cli update' "$TEST_ROOT/delayed-stop/events"
run_case unresolved 42
! grep -q '^service start$' "$TEST_ROOT/unresolved/events"
run_case signal 143
grep -q '^service start$' "$TEST_ROOT/signal/events"

NODE_NO_WARNINGS=1 node tests/test_openclaw_update.mjs
# 构建入口必须同时安装 shell 编排器与 Node.js 检查器。
for builder in scripts/build_ipk.sh scripts/build_apk.sh scripts/build_run.sh; do
	grep -Fq 'root/usr/libexec/openclaw-update-receipt.mjs' "$builder"
	grep -Fq 'root/usr/libexec/openclaw-update-cleanup.mjs' "$builder"
done
grep -Fq 'root/usr/libexec/openclaw-update.sh' Makefile
grep -Fq 'root/usr/libexec/openclaw-update-receipt.mjs' Makefile
grep -Fq 'root/usr/libexec/openclaw-update-cleanup.mjs' Makefile
grep -Fq 'sh tests/test_openclaw_update.sh' .github/workflows/build.yml
echo 'ok: upgrade execution and procd recovery cases'
