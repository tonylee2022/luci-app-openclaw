#!/bin/sh
# OpenClaw Node.js 版本校验工具。
# OpenClaw 2026.10.6 的完整运行时要求，所有入口共用。
OC_NODE_SUPPORTED_RANGE='>=24.22.1 <25 || >=26.12.1'

oc_normalize_node_version() {
	local raw="${1:-}"
	raw=${raw#v}
	printf '%s\n' "$raw" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || return 1
	printf '%s\n' "$raw"
}

oc_read_node_version() {
	local node_bin="$1"
	local raw
	[ -x "$node_bin" ] || return 1
	raw=$("$node_bin" --version 2>/dev/null) || return 1
	oc_normalize_node_version "$raw"
}

oc_node_version_ge() {
	local current required
	current=$(oc_normalize_node_version "$1") || return 1
	required=$(oc_normalize_node_version "$2") || return 1

	awk -v a="$current" -v b="$required" '
		BEGIN {
			split(a, av, "."); split(b, bv, ".");
			for (i = 1; i <= 3; i++) {
				ai = av[i] + 0; bi = bv[i] + 0;
				if (ai > bi) exit 0;
				if (ai < bi) exit 1;
			}
			exit 0;
		}
	'
}

oc_node_version_in_range() {
	local current
	current=$(oc_normalize_node_version "$1") || return 1
	# 上游 engines 使用比较符、空格交集和 || 并集；未知语法一律拒绝。
	awk -v current="$current" -v requirement="$2" '
		function compare(a, b, av, bv, i) {
			split(a, av, "."); split(b, bv, ".");
			for (i = 1; i <= 3; i++) {
				if (av[i] + 0 > bv[i] + 0) return 1;
				if (av[i] + 0 < bv[i] + 0) return -1;
			}
			return 0;
		}
		BEGIN {
			valid = 1; matched = 0;
			count = split(requirement, branches, /\|\|/);
			for (i = 1; i <= count; i++) {
				branch = branches[i];
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", branch);
				if (branch == "") { valid = 0; continue; }
				n = split(branch, tokens, /[[:space:]]+/); accepted = 1;
				for (j = 1; j <= n; j++) {
					token = tokens[j]; op = "=";
					if (match(token, /^(>=|<=|>|<|=)/)) {
						op = substr(token, 1, RLENGTH); token = substr(token, RLENGTH + 1);
					}
					if (token !~ /^[0-9]+([.][0-9]+)?([.][0-9]+)?$/) { valid = 0; continue; }
					c = compare(current, token);
					if (!((op == "=" && c == 0) || (op == ">=" && c >= 0) ||
					      (op == "<=" && c <= 0) || (op == ">" && c > 0) || (op == "<" && c < 0))) accepted = 0;
				}
				if (accepted) matched = 1;
			}
			exit !(valid && matched);
		}
	'
}

oc_read_node_requirement() {
	# 使用待校验运行时读取包元数据，不执行 OpenClaw 入口或第三方插件。
	OC_PKG_JSON="$2" "$1" -e '
const fs=require("fs");
try {
 const spec=JSON.parse(fs.readFileSync(process.env.OC_PKG_JSON,"utf8")).engines?.node;
 if(typeof spec!=="string" || !spec.trim()) process.exitCode=1;
 else process.stdout.write(spec);
} catch { process.exitCode=1; }
'
}

oc_assert_node_version_range() {
	local current
	current=$(oc_read_node_version "$1") || {
		echo "  [✗] Node.js 不可执行或无法读取版本: $1"
		return 1
	}
	if ! oc_node_version_in_range "$current" "$2"; then
		echo "  [✗] Node.js v${current} 不满足 OpenClaw 要求: $2"
		echo "  [!] 请通过环境升级更换为受支持的 Node.js 版本"
		return 1
	fi
	echo "  [✓] Node.js v${current} 满足要求 ($2)"
}

oc_assert_node_min_version() {
	local node_bin="$1"
	local required="$2"
	local current

	current=$(oc_read_node_version "$node_bin") || {
		echo "  [✗] Node.js 不可执行或无法读取版本: $node_bin"
		return 1
	}

	if ! oc_node_version_ge "$current" "$required"; then
		echo "  [✗] Node.js v${current} 低于 OpenClaw 要求 v${required}"
		echo "  [!] 请重新运行 openclaw-env node 或 openclaw-env setup 更新运行时"
		return 1
	fi

	echo "  [✓] Node.js v${current} 满足要求 (>= v${required})"
	return 0
}
