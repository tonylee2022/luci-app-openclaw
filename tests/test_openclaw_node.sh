#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-node.sh

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

[ "$(oc_normalize_node_version v22.22.3)" = "22.22.3" ] || fail "normalize v"
oc_node_version_ge 22.22.3 22.22.3 || fail "exact minimum version"
oc_node_version_ge 22.22.4 22.22.3 || fail "newer Node 22"
oc_node_version_ge 23.0.0 22.22.3 || fail "numeric baseline comparison"
oc_node_version_ge 24.0.0 22.22.3 || fail "newer major baseline comparison"
if oc_node_version_ge 22.22.2 22.22.3; then
	fail "older minor accepted"
fi

echo "ok"
