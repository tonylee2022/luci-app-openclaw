#!/bin/sh
set -eu

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

OPENCLAW_PATHS_HELPER=./root/usr/libexec/openclaw-paths.sh
OPENCLAW_BACKUP_HELPER=./root/usr/libexec/openclaw-backup.sh
OPENCLAW_OPERATION_LOCK="$TEST_ROOT/operation.lock"
OPENCLAW_RPC_LIBRARY_ONLY=1
export OPENCLAW_PATHS_HELPER OPENCLAW_BACKUP_HELPER OPENCLAW_OPERATION_LOCK OPENCLAW_RPC_LIBRARY_ONLY
. ./root/usr/libexec/openclaw-rpc.sh

fail_test() { echo "FAIL: $1" >&2; exit 1; }

acquire_operation_lock first
[ -d "$OPENCLAW_OPERATION_LOCK" ] || fail_test "operation lock was not created"
if ( acquire_operation_lock second ) >/dev/null 2>&1; then
	fail_test "concurrent operation acquired the lock"
fi
release_operation_lock

start_task "$TEST_ROOT/task" "sleep 1"
[ -d "$OPENCLAW_OPERATION_LOCK" ] || fail_test "async task did not retain the lock"
task_pid=$(cat "$TEST_ROOT/task.pid")
wait "$task_pid"
[ ! -d "$OPENCLAW_OPERATION_LOCK" ] || fail_test "async task did not release the lock"
[ "$(cat "$TEST_ROOT/task.exit")" = "0" ] || fail_test "async task exit status missing"
[ ! -e "$TEST_ROOT/task.pid" ] || fail_test "completed task PID was not removed"

started=$(date +%s)
output=$(
	start_task "$TEST_ROOT/detached" "sleep 3; echo detached-output"
	echo submitted
)
elapsed=$(( $(date +%s) - started ))
[ "$output" = "submitted" ] || fail_test "detached task leaked output to the caller"
[ "$elapsed" -lt 2 ] || fail_test "detached task kept the caller output pipe open"
i=0
while [ ! -f "$TEST_ROOT/detached.exit" ] && [ "$i" -lt 5 ]; do
	sleep 1
	i=$((i + 1))
done
[ "$(cat "$TEST_ROOT/detached.exit")" = "0" ] || fail_test "detached task exit status missing"
grep -q 'detached-output' "$TEST_ROOT/detached.log" || fail_test "detached task log is incomplete"
[ ! -e "$TEST_ROOT/detached.pid" ] || fail_test "detached task PID was not removed"

echo 999999 > "$TEST_ROOT/stale.pid"
if task_running "$TEST_ROOT/stale"; then
	fail_test "stale task PID was treated as active"
fi
[ ! -e "$TEST_ROOT/stale.pid" ] || fail_test "stale task PID was not removed"

mkdir "$OPENCLAW_OPERATION_LOCK"
echo 999999 > "$OPENCLAW_OPERATION_LOCK/pid"
if operation_locked; then
	fail_test "stale operation lock was treated as active"
fi
[ ! -d "$OPENCLAW_OPERATION_LOCK" ] || fail_test "stale operation lock was not removed"

echo ok
