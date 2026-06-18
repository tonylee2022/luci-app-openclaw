#!/bin/sh
set -eu

. ./root/usr/libexec/openclaw-workspace.sh

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

OC_HOME="$TEST_ROOT/openclaw"
OC_STATE_DIR="$OC_HOME/.openclaw"
OC_GLOBAL="$OC_HOME/.npm-global"
OC_NPM_CACHE="$OC_HOME/.npm"
OC_TMP="$OC_HOME/.tmp"
CONFIG_FILE="$OC_STATE_DIR/openclaw.json"
NODE_BIN=""
mkdir -p "$OC_STATE_DIR" "$OC_TMP"

oc_sync_workspace_tools
TOOLS_FILE="$OC_STATE_DIR/workspace/AGENTS.md"
[ -f "$TOOLS_FILE" ] || fail "default AGENTS.md was not created"
grep -Fq 'luci-app-openclaw' "$TOOLS_FILE" || fail "luci-app-openclaw attribution missing"
grep -Fq "$OC_STATE_DIR" "$TOOLS_FILE" || fail "runtime state path missing"

{
	echo '# User tools'
	cat "$TOOLS_FILE"
	echo 'Keep this user note.'
} > "$TEST_ROOT/user-tools.md"
mv "$TEST_ROOT/user-tools.md" "$TOOLS_FILE"
oc_sync_workspace_tools
[ "$(grep -F -x -c "$OC_TOOLS_BLOCK_START" "$TOOLS_FILE")" -eq 1 ] || fail "managed block duplicated"
grep -Fq '# User tools' "$TOOLS_FILE" || fail "user prefix was not preserved"
grep -Fq 'Keep this user note.' "$TOOLS_FILE" || fail "user suffix was not preserved"

EXTERNAL_FILE="$TEST_ROOT/external-tools.md"
echo 'external content' > "$EXTERNAL_FILE"
rm -f "$TOOLS_FILE"
ln -s "$EXTERNAL_FILE" "$TOOLS_FILE"
oc_sync_workspace_tools
[ "$(cat "$EXTERNAL_FILE")" = 'external content' ] || fail "AGENTS.md symlink target was modified"

MOCK_NODE="$TEST_ROOT/mock-node"
cat > "$MOCK_NODE" <<'EOF'
#!/bin/sh
printf '%s' "$MOCK_WORKSPACE"
EOF
chmod +x "$MOCK_NODE"
echo '{}' > "$CONFIG_FILE"
NODE_BIN="$MOCK_NODE"

MOCK_WORKSPACE="$OC_STATE_DIR/custom-workspace"
export MOCK_WORKSPACE
oc_sync_workspace_tools
[ -f "$MOCK_WORKSPACE/AGENTS.md" ] || fail "custom workspace inside state dir was not updated"

MOCK_WORKSPACE="$OC_STATE_DIR/workspace/../../escaped-workspace"
export MOCK_WORKSPACE
oc_sync_workspace_tools
[ ! -e "$OC_HOME/escaped-workspace" ] || fail "workspace traversal must not be followed"

MOCK_WORKSPACE="$TEST_ROOT/outside-workspace"
export MOCK_WORKSPACE
oc_sync_workspace_tools
[ ! -e "$TEST_ROOT/outside-workspace" ] || fail "external workspace must not be modified"

echo "ok"
