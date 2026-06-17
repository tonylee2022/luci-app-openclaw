#!/bin/sh

OC_TOOLS_BLOCK_START='<!-- luci-app-openclaw:openwrt-runtime:start -->'
OC_TOOLS_BLOCK_END='<!-- luci-app-openclaw:openwrt-runtime:end -->'

oc_workspace_warn() {
	if command -v log_warn >/dev/null 2>&1; then
		log_warn "$1"
	else
		echo "openclaw-workspace: $1" >&2
	fi
}

oc_workspace_path() {
	local workspace="${OC_STATE_DIR}/workspace"
	local configured=""

	if [ -x "${NODE_BIN:-}" ] && [ -f "${CONFIG_FILE:-}" ]; then
		configured=$(OPENCLAW_CONFIG_PATH="$CONFIG_FILE" "$NODE_BIN" -e '
const fs = require("fs");
try {
  const config = JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
  const workspace = config?.agents?.defaults?.workspace;
  if (typeof workspace === "string" && workspace.length > 0) process.stdout.write(workspace);
} catch (_) {}
' 2>/dev/null || true)
		[ -n "$configured" ] && workspace="$configured"
	fi

	printf '%s\n' "${workspace%/}"
}

oc_sync_workspace_tools() {
	local workspace tools_file start_count end_count tmp_file block_file relative current segment old_ifs
	workspace=$(oc_workspace_path)

	case "$workspace" in
		"${OC_STATE_DIR}"/*) ;;
		*)
			oc_workspace_warn "工作区位于 OpenClaw 状态目录之外，跳过 TOOLS.md 运行环境说明: $workspace"
			return 0
			;;
	esac
	case "$workspace/" in
		*/../*|*/./*|*//* )
			oc_workspace_warn "工作区路径包含不安全的路径段，跳过 TOOLS.md 运行环境说明: $workspace"
			return 0
			;;
	esac

	if [ -L "$OC_STATE_DIR" ]; then
		oc_workspace_warn "OpenClaw 状态目录是符号链接，跳过 TOOLS.md 运行环境说明: $OC_STATE_DIR"
		return 0
	fi
	relative=${workspace#"${OC_STATE_DIR}/"}
	current="$OC_STATE_DIR"
	old_ifs=$IFS
	IFS='/'
	for segment in $relative; do
		current="${current}/${segment}"
		if [ -L "$current" ]; then
			IFS=$old_ifs
			oc_workspace_warn "工作区路径包含符号链接，跳过 TOOLS.md 运行环境说明: $current"
			return 0
		fi
	done
	IFS=$old_ifs

	mkdir -p "$workspace" || return 1
	tools_file="${workspace}/TOOLS.md"
	if [ -L "$tools_file" ]; then
		oc_workspace_warn "TOOLS.md 是符号链接，跳过运行环境说明: $tools_file"
		return 0
	fi

	tmp_file=$(mktemp "${OC_TMP:-/tmp}/openclaw-tools.XXXXXX") || return 1
	block_file=$(mktemp "${OC_TMP:-/tmp}/openclaw-tools-block.XXXXXX") || {
		rm -f "$tmp_file"
		return 1
	}

	cat > "$block_file" <<EOF
$OC_TOOLS_BLOCK_START
## OpenWrt runtime environment

This OpenClaw instance is deployed by luci-app-openclaw and its Gateway process is managed by OpenWrt procd.

- Restart the complete service: \`/etc/init.d/openclaw restart\`
- Restart only the Gateway instance: \`/etc/init.d/openclaw restart_gateway\`
- Query service status: \`/etc/init.d/openclaw status_service\`
- \`openclaw gateway health\` and \`openclaw gateway status\` are query commands; lifecycle operations for this deployment use the init script above.

Runtime directories:

- OpenClaw HOME: \`$OC_HOME\`
- OpenClaw state: \`$OC_STATE_DIR\`
- npm prefix: \`$OC_GLOBAL\`
- npm cache: \`$OC_NPM_CACHE\`
- temporary files: \`$OC_TMP\`
$OC_TOOLS_BLOCK_END
EOF

	if [ -f "$tools_file" ]; then
		start_count=$(grep -F -x -c "$OC_TOOLS_BLOCK_START" "$tools_file" 2>/dev/null || true)
		end_count=$(grep -F -x -c "$OC_TOOLS_BLOCK_END" "$tools_file" 2>/dev/null || true)
		if [ "$start_count" -eq 0 ] && [ "$end_count" -eq 0 ]; then
			cat "$tools_file" > "$tmp_file"
			[ ! -s "$tmp_file" ] || printf '\n' >> "$tmp_file"
			cat "$block_file" >> "$tmp_file"
		elif [ "$start_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
			awk -v start="$OC_TOOLS_BLOCK_START" -v end="$OC_TOOLS_BLOCK_END" -v block="$block_file" '
				$0 == start {
					while ((getline line < block) > 0) print line
					close(block)
					skipping = 1
					next
				}
				skipping && $0 == end { skipping = 0; next }
				!skipping { print }
			' "$tools_file" > "$tmp_file"
		else
			oc_workspace_warn "TOOLS.md 中的托管标记不完整或重复，未修改用户文件: $tools_file"
			rm -f "$tmp_file" "$block_file"
			return 0
		fi
	else
		cat "$block_file" > "$tmp_file"
	fi

	mv "$tmp_file" "$tools_file"
	rm -f "$block_file"
	chown openclaw:openclaw "$workspace" "$tools_file" 2>/dev/null || true
}
