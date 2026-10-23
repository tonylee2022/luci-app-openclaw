#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-node.sh

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

[ "$(oc_normalize_node_version v24.22.1)" = "24.22.1" ] || fail "normalize v"
oc_node_version_ge 24.22.1 24.22.1 || fail "exact minimum version"
oc_node_version_ge 24.23.0 24.22.1 || fail "newer Node 24"
oc_node_version_ge 26.12.1 24.22.1 || fail "numeric baseline comparison"
if oc_node_version_ge 24.22.0 24.22.1; then
	fail "older minor accepted"
fi
for version in 24.22.1 24.23.0 24.100.0 26.12.1 26.13.0 27.0.0; do
	oc_node_version_in_range "$version" "$OC_NODE_SUPPORTED_RANGE" || fail "supported version rejected: $version"
done
for version in 22.22.3 24.17.0 24.22.0 25.0.0 25.99.0 26.1.0 26.12.0 26.12.1-rc.1 24.22 024.22.1 garbage; do
	if oc_node_version_in_range "$version" "$OC_NODE_SUPPORTED_RANGE"; then fail "unsupported version accepted: $version"; fi
done
oc_node_version_in_range 24.22.1 '>24.22.0 <=24.22.1' || fail "strict and inclusive bounds"
oc_node_version_in_range 26.12.1 '=26.12.1' || fail "exact comparator"
for requirement in '>=26.12.1' '>24.22.1' '<24' '' '*' '^24.22.1' '>=24.22.1 || garbage' '>=24.22.1 ||'; do
	if oc_node_version_in_range 24.22.1 "$requirement"; then fail "nonmatching or invalid range accepted: $requirement"; fi
done

# 运行真实下载及暂存替换流程，用本地安装包代替网络，避免修改主机运行时。
NODE_TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$NODE_TEST_ROOT"' EXIT
# 读取实际 package.json 的完整要求，避免再次只保留第一个最低版本号。
mkdir "$NODE_TEST_ROOT/metadata"
printf '%s\n' '{"engines":{"node":">=24.22.1 <25 || >=26.12.1"}}' > "$NODE_TEST_ROOT/metadata/package.json"
NODE_BIN=$(command -v node)
find_oc_entry() { echo "$NODE_TEST_ROOT/metadata/openclaw.mjs"; }
eval "$(sed -n '/^detect_oc_node_requirement() {$/,/^assert_node_runtime() {$/p' root/usr/bin/openclaw-env | sed '$d')"
[ "$(detect_oc_node_requirement)" = "$OC_NODE_SUPPORTED_RANGE" ] || fail "package engines range truncated"
cat > "$NODE_TEST_ROOT/runner.sh" <<'RUNNER'
#!/bin/sh
set -eu
. ./root/usr/libexec/openclaw-node.sh
NODE_BASE="$NODE_CASE_DIR/node"
NODE_BIN="$NODE_BASE/bin/node"
OC_NODE_MIN_VERSION=24.22.1
NODE_MIRROR="https://invalid.example/node"
NODE_MIRROR_CN="$NODE_MIRROR"
log_info() { echo "$1"; }
log_warn() { echo "$1"; }
log_error() { echo "$1"; }
detect_arch() { echo linux-x64; }
detect_libc() { echo glibc; }
ensure_mkdir() { mkdir -p "$1"; }
assert_node_runtime() {
	oc_assert_node_version_range "$NODE_BIN" "$OC_NODE_SUPPORTED_RANGE" || exit 1
	oc_assert_node_min_version "$NODE_BIN" "$OC_NODE_MIN_VERSION" || exit 1
	oc_assert_node_version_range "$NODE_BIN" "${NODE_PACKAGE_RANGE:-$OC_NODE_SUPPORTED_RANGE}" || exit 1
}
curl() {
	echo download >> "$NODE_CASE_DIR/events"
	while [ "$#" -gt 0 ]; do
		if [ "$1" = -o ]; then cp "$NODE_CASE_DIR/package.tar.gz" "$2"; return; fi
		shift
	done
	return 1
}
wget() { return 1; }
mv() {
	command mv "$@" || return
	# 模拟替换后实际路径与已校验暂存目录不一致。
	if [ "${NODE_POST_MISMATCH:-0}" = 1 ]; then
		printf '#!/bin/sh\necho v24.17.0\n' > "$NODE_BIN"
	fi
}
RUNNER
sed -n '/^download_node() {$/,/^install_pnpm() {$/p' root/usr/bin/openclaw-env | sed '$d' >> "$NODE_TEST_ROOT/runner.sh"
echo 'download_node "$1"' >> "$NODE_TEST_ROOT/runner.sh"

run_node_case() {
	local name="$1" current="$2" target="$3" package_version="$4" expected_rc="$5"
	local case_dir="$NODE_TEST_ROOT/$name" rc=0
	mkdir -p "$case_dir/node/bin" "$case_dir/package/bin"
	printf '#!/bin/sh\necho v%s\n' "$current" > "$case_dir/node/bin/node"
	if [ "$package_version" = broken ]; then
		printf '#!/bin/sh\nexit 1\n' > "$case_dir/package/bin/node"
	else
		printf '#!/bin/sh\necho v%s\n' "$package_version" > "$case_dir/package/bin/node"
	fi
	chmod +x "$case_dir/node/bin/node" "$case_dir/package/bin/node"
	tar czf "$case_dir/package.tar.gz" -C "$case_dir" package
	# gzip 允许末尾补零，让微型测试包通过真实下载大小检查。
	dd if=/dev/zero bs=1048576 count=5 >> "$case_dir/package.tar.gz" 2>/dev/null
	NODE_CASE_DIR="$case_dir" NODE_POST_MISMATCH="${6:-0}" \
		sh "$NODE_TEST_ROOT/runner.sh" "$target" > "$case_dir/log" 2>&1 || rc=$?
	if [ "$rc" -ne "$expected_rc" ]; then
		cat "$case_dir/log"
		fail "$name exited $rc, expected $expected_rc"
	fi
}

run_node_case same-version 24.22.1 24.22.1 24.22.1 0
[ ! -f "$NODE_TEST_ROOT/same-version/events" ] || fail "same version downloaded again"
run_node_case same-major-upgrade 24.17.0 24.22.1 24.22.1 0
run_node_case same-major-downgrade 24.23.0 24.22.1 24.22.1 0
run_node_case cross-major 26.12.1 24.22.1 24.22.1 0
for name in same-major-upgrade same-major-downgrade cross-major; do
	grep -q '^download$' "$NODE_TEST_ROOT/$name/events" || fail "$name skipped download"
done
[ "$("$NODE_TEST_ROOT/same-major-upgrade/node/bin/node" --version)" = v24.22.1 ] || fail "upgrade did not apply requested version"
[ "$("$NODE_TEST_ROOT/same-major-downgrade/node/bin/node" --version)" = v24.22.1 ] || fail "downgrade did not apply requested version"
run_node_case wrong-package 24.17.0 24.22.1 24.17.0 1
run_node_case broken-package 24.17.0 24.22.1 broken 1
for name in wrong-package broken-package; do
	[ "$("$NODE_TEST_ROOT/$name/node/bin/node" --version)" = v24.17.0 ] || fail "$name replaced existing Node"
	[ ! -d "$NODE_TEST_ROOT/$name/node.new" ] || fail "$name left staging directory"
done
run_node_case installed-mismatch 24.17.0 24.22.1 24.22.1 1 1
! grep -q '安装成功' "$NODE_TEST_ROOT/installed-mismatch/log" || fail "installed mismatch reported success"
for target in 24.17.0 25.0.0 26.12.0; do
	run_node_case "refused-$target" 24.22.1 "$target" "$target" 1
	[ ! -f "$NODE_TEST_ROOT/refused-$target/events" ] || fail "unsupported target downloaded: $target"
	[ "$("$NODE_TEST_ROOT/refused-$target/node/bin/node" --version)" = v24.22.1 ] || fail "unsupported target changed runtime"
done
NODE_PACKAGE_RANGE='>=26.12.1' run_node_case package-incompatible 26.12.1 24.22.1 24.22.1 1
[ "$("$NODE_TEST_ROOT/package-incompatible/node/bin/node" --version)" = v26.12.1 ] || fail "package incompatibility replaced runtime"

echo "ok"
