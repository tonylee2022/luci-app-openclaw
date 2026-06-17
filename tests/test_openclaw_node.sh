#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-node.sh

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

[ "$(oc_normalize_node_version v22.19.0)" = "22.19.0" ] || fail "normalize v"
oc_node_version_ge 22.19.0 22.19.0 || fail "exact minimum version"
oc_node_version_ge 22.22.3 22.19.0 || fail "default version"
oc_node_version_ge 23.0.0 22.19.0 || fail "Node 23"
oc_node_version_ge 24.0.0 22.19.0 || fail "Node 24"
if oc_node_version_ge 22.18.9 22.19.0; then
	fail "older minor accepted"
fi

echo "ok"
