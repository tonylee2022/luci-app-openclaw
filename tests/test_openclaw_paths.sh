#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-paths.sh

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

oc_load_paths "/mnt/data/openclaw"
[ "$OPENCLAW_INSTALL_PATH" = "/mnt/data" ] || fail "strip trailing openclaw"
[ "$OC_ROOT" = "/mnt/data/openclaw" ] || fail "derive root"
[ "$OC_HOME" = "/mnt/data/openclaw" ] || fail "derive home"
[ "$OC_GLOBAL" = "/mnt/data/openclaw/.npm-global" ] || fail "derive npm prefix"
[ "$OC_STATE_DIR" = "/mnt/data/openclaw/.openclaw" ] || fail "derive state dir"
[ "$OC_NPM_CACHE" = "/mnt/data/openclaw/.npm" ] || fail "derive npm cache"
[ "$OC_TMP" = "/mnt/data/openclaw/.tmp" ] || fail "derive tmp dir"
[ "$CONFIG_FILE" = "/mnt/data/openclaw/.openclaw/openclaw.json" ] || fail "derive config"

if oc_normalize_install_path "relative/path" >/dev/null 2>&1; then
	fail "relative path must be rejected"
fi

if oc_normalize_install_path "/mnt/data bad" >/dev/null 2>&1; then
	fail "path with whitespace must be rejected"
fi

oc_safe_openclaw_root "/mnt/data/openclaw" || fail "safe root rejected"
if oc_safe_openclaw_root "/mnt/data"; then
	fail "non-openclaw root accepted"
fi

quoted=$(oc_quote "/mnt/a'b/openclaw")
[ "$quoted" = "'/mnt/a'\\''b/openclaw'" ] || fail "shell quote"

echo "ok"
