#!/bin/sh

OC_TOOLS_BLOCK_START='<!-- luci-app-openclaw:openwrt-runtime:start -->'
OC_TOOLS_BLOCK_END='<!-- luci-app-openclaw:openwrt-runtime:end -->'
OC_OPERATING_FILE='AGENTS.md'
OC_TOOLS_FILE='TOOLS.md'

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
	local workspace target_file start_count end_count tmp_file block_file relative current segment old_ifs
	workspace=$(oc_workspace_path)

	case "$workspace" in
		"${OC_STATE_DIR}"/*) ;;
		*)
			oc_workspace_warn "工作区位于 OpenClaw 状态目录之外，跳过运行环境说明注入: $workspace"
			return 0
			;;
	esac
	case "$workspace/" in
		*/../*|*/./*|*//* )
			oc_workspace_warn "工作区路径包含不安全的路径段，跳过运行环境说明注入: $workspace"
			return 0
			;;
	esac

	if [ -L "$OC_STATE_DIR" ]; then
		oc_workspace_warn "OpenClaw 状态目录是符号链接，跳过运行环境说明注入: $OC_STATE_DIR"
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
			oc_workspace_warn "工作区路径包含符号链接，跳过运行环境说明注入: $current"
			return 0
		fi
	done
	IFS=$old_ifs

	mkdir -p "$workspace" || return 1
	target_file="${workspace}/${OC_OPERATING_FILE}"
	if [ -L "$target_file" ]; then
		oc_workspace_warn "${OC_OPERATING_FILE} 是符号链接，跳过运行环境说明注入: $target_file"
		return 0
	fi

	tmp_file=$(mktemp "${OC_TMP:-/tmp}/openclaw-tools.XXXXXX") || return 1
	block_file=$(mktemp "${OC_TMP:-/tmp}/openclaw-tools-block.XXXXXX") || {
		rm -f "$tmp_file"
		return 1
	}

	cat > "$block_file" <<EOF
$OC_TOOLS_BLOCK_START
## 7. 部署环境硬约束（由 luci-app-openclaw 注入，禁止手动编辑此区块）

本实例由 luci-app-openclaw 部署，Gateway 进程由 OpenWrt procd 以 root 身份管理。
`openclaw` 用户**没有权限**执行 init 脚本或控制服务生命周期，不要尝试。

需要重启服务或 Gateway 时：告知**用户**通过 LuCI 界面操作，或以 root 身份 SSH 执行。

运行目录（只读参考，不要修改）：

- OpenClaw HOME: \`$OC_HOME\`
- OpenClaw state: \`$OC_STATE_DIR\`
- npm prefix: \`$OC_GLOBAL\`
- npm cache: \`$OC_NPM_CACHE\`
- temporary files: \`$OC_TMP\`
$OC_TOOLS_BLOCK_END
EOF

	if [ -f "$target_file" ]; then
		start_count=$(grep -F -x -c "$OC_TOOLS_BLOCK_START" "$target_file" 2>/dev/null || true)
		end_count=$(grep -F -x -c "$OC_TOOLS_BLOCK_END" "$target_file" 2>/dev/null || true)
		if [ "$start_count" -eq 0 ] && [ "$end_count" -eq 0 ]; then
			cat "$target_file" > "$tmp_file"
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
			' "$target_file" > "$tmp_file"
		else
			oc_workspace_warn "${OC_OPERATING_FILE} 中的托管标记不完整或重复，未修改用户文件: $target_file"
			rm -f "$tmp_file" "$block_file"
			return 0
		fi
	else
		cat "$block_file" > "$tmp_file"
	fi

	mv "$tmp_file" "$target_file"
	rm -f "$block_file"
	chown openclaw:openclaw "$workspace" "$target_file" 2>/dev/null || true
}
