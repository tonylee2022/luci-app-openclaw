#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-backup.sh

fail() { echo "FAIL: $1" >&2; exit 1; }

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
STATE_DIR="/mnt/data/openclaw/.openclaw"
ARCHIVE_ROOT="$TEST_ROOT/source/safe-backup"
RESTORE_PATH="$ARCHIVE_ROOT/payload/posix/mnt/data/openclaw/.openclaw"
mkdir -p "$RESTORE_PATH"
echo '{}' > "$RESTORE_PATH/openclaw.json"
echo '{"onlyConfig":true}' > "$ARCHIVE_ROOT/manifest.json"
tar -czf "$TEST_ROOT/safe.tar.gz" -C "$TEST_ROOT/source" safe-backup
mkdir -p "$TEST_ROOT/stage-safe"
result=$(oc_prepare_backup_restore "$TEST_ROOT/safe.tar.gz" "$STATE_DIR" "$TEST_ROOT/stage-safe") || fail "safe backup rejected"
[ -f "$result/openclaw.json" ] || fail "safe backup state was not staged"

BAD_ROOT="$TEST_ROOT/bad-source/bad-backup"
mkdir -p "$BAD_ROOT/payload/posix/etc"
echo bad > "$BAD_ROOT/payload/posix/etc/passwd"
echo '{}' > "$BAD_ROOT/manifest.json"
tar -czf "$TEST_ROOT/outside.tar.gz" -C "$TEST_ROOT/bad-source" bad-backup
mkdir -p "$TEST_ROOT/stage-outside"
if oc_prepare_backup_restore "$TEST_ROOT/outside.tar.gz" "$STATE_DIR" "$TEST_ROOT/stage-outside" >/dev/null 2>&1; then
	fail "backup containing non-state payload was accepted"
fi

LINK_ROOT="$TEST_ROOT/link-source/link-backup"
LINK_PATH="$LINK_ROOT/payload/posix/mnt/data/openclaw/.openclaw"
mkdir -p "$LINK_PATH"
echo '{}' > "$LINK_PATH/openclaw.json"
ln -s /etc/passwd "$LINK_PATH/escape"
echo '{}' > "$LINK_ROOT/manifest.json"
tar -czf "$TEST_ROOT/link.tar.gz" -C "$TEST_ROOT/link-source" link-backup
mkdir -p "$TEST_ROOT/stage-link"
if oc_prepare_backup_restore "$TEST_ROOT/link.tar.gz" "$STATE_DIR" "$TEST_ROOT/stage-link" >/dev/null 2>&1; then
	fail "backup containing a symbolic link was accepted"
fi

echo ok
