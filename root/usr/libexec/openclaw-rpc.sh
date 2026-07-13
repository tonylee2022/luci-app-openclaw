#!/bin/sh
set -u

. "${OPENCLAW_PATHS_HELPER:-/usr/libexec/openclaw-paths.sh}"

OPERATION_LOCK="${OPENCLAW_OPERATION_LOCK:-/var/lock/openclaw-operation.lock}"

fail() {
	echo "$1" >&2
	exit 1
}

load_paths() {
	base=$(uci -q get openclaw.main.install_path || echo /opt)
	oc_load_paths "$base" || fail "Invalid UCI install path"
}

task_running() {
	prefix="$1"
	if [ -f "${prefix}.exit" ]; then
		rm -f "${prefix}.pid"
		return 1
	fi
	[ -f "${prefix}.pid" ] || return 1
	pid=$(tr -dc '0-9' < "${prefix}.pid")
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		return 0
	fi
	rm -f "${prefix}.pid"
	return 1
}

operation_locked() {
	[ -d "$OPERATION_LOCK" ] || return 1
	if [ -f "$OPERATION_LOCK/pid" ]; then
		lock_pid=$(tr -dc '0-9' < "$OPERATION_LOCK/pid")
		if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
			rm -rf "$OPERATION_LOCK"
			return 1
		fi
	fi
	return 0
}

acquire_operation_lock() {
	operation="${1:-unknown}"
	operation_locked && fail "Another OpenClaw system operation is in progress"
	mkdir "$OPERATION_LOCK" 2>/dev/null || fail "Another OpenClaw system operation is in progress"
	printf '%s\n' "$$" > "$OPERATION_LOCK/pid"
	printf '%s\n' "$operation" > "$OPERATION_LOCK/operation"
}

release_operation_lock() {
	rm -rf "$OPERATION_LOCK"
}

# 递归杀掉某进程及其所有子进程 (本环境无 setsid/pkill, 用 pgrep -P 自底向上)。
# 等价命令行 Ctrl+C: UI 取消/关闭面板时调用, 确保后台进程(node/npx 等)真正退出。
kill_tree() {
	local pid="$1" child
	[ -n "$pid" ] || return 0
	for child in $(pgrep -P "$pid" 2>/dev/null); do
		kill_tree "$child"
	done
	kill -TERM "$pid" 2>/dev/null || true
}

# 取消某后台任务: 杀掉进程树 + 写入退出码 130(SIGINT) + 释放锁。
cancel_task() {
	prefix="$1"
	pid=$(tr -dc '0-9' < "${prefix}.pid" 2>/dev/null || true)
	[ -n "$pid" ] && kill_tree "$pid"
	echo 130 > "${prefix}.exit"
	rm -f "${prefix}.pid"
	release_operation_lock
}

start_task() {
	prefix="$1"
	command="$2"
	task_log="${3:-${prefix}.log}"
	if task_running "$prefix"; then
		fail "A task of the same type is already running"
	fi
	acquire_operation_lock "${prefix##*/}"
	rm -f "${prefix}.log" "${prefix}.pid" "${prefix}.exit" "$task_log"
	(
		trap 'release_operation_lock' EXIT INT TERM
		sh -c "$command" > "$task_log" 2>&1
		rc=$?
		echo "$rc" > "${prefix}.exit"
		rm -f "${prefix}.pid"
	) </dev/null >/dev/null 2>&1 &
	task_pid=$!
	echo "$task_pid" > "${prefix}.pid"
	echo "$task_pid" > "$OPERATION_LOCK/pid" 2>/dev/null || true
}

find_openclaw_entry() {
	for entry in \
		"$OC_GLOBAL/lib/node_modules/openclaw/openclaw.mjs" \
		"$OC_GLOBAL/node_modules/openclaw/openclaw.mjs" \
		"$NODE_BASE/lib/node_modules/openclaw/openclaw.mjs" \
		"$OC_GLOBAL/lib/node_modules/openclaw/dist/cli.js" \
		"$OC_GLOBAL/node_modules/openclaw/dist/cli.js"; do
		[ -f "$entry" ] && { printf '%s\n' "$entry"; return 0; }
	done
	return 1
}

# 以 openclaw 用户运行 openclaw CLI 的环境前缀 (需先 load_paths)。
# OPENCLAW_GATEWAY_TOKEN 让 CLI 与网关用同一令牌连接(env 赢过 openclaw.json 的引用/明文),
# 与 init.d 注入的令牌一致; 用户在 OpenClaw 内迁移 gateway.auth.token 时 CLI 仍能认证。
oc_cli_env() {
	printf '%s' "HOME=$OC_HOME OPENCLAW_HOME=$OC_HOME OPENCLAW_STATE_DIR=$OC_STATE_DIR OPENCLAW_CONFIG_PATH=$CONFIG_FILE NPM_CONFIG_PREFIX=$OC_GLOBAL NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP OPENCLAW_GATEWAY_TOKEN=$(uci -q get openclaw.main.token 2>/dev/null) PATH=$NODE_BASE/bin:$OC_GLOBAL/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

# 同步执行一条 openclaw CLI 子命令并把 stdout 原样输出 (供 ucode json 解析)。
# 用法: oc_cli_run "doctor --lint --json"
oc_cli_run() {
	load_paths
	entry=$(find_openclaw_entry) || fail "OpenClaw is not installed"
	id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
	# 直接交给 su -c (单层解析), 此处不可用 oc_quote, 否则单引号会成为字面量。
	# timeout 安全网: 同步 CLI 经 ucode popen 跑在 rpcd 的 uloop 上, 网关挂死时会阻塞整个 rpcd → LuCI 打不开。
	# 30s 宽于正常慢操作(health/logs 自带 12s), 但杜绝无限阻塞。
	timeout 30 su -s /bin/sh openclaw -c "$(oc_cli_env) $NODE_BASE/bin/node $entry $1"
}

if [ "${OPENCLAW_RPC_LIBRARY_ONLY:-0}" = "1" ]; then
	return 0 2>/dev/null || exit 0
fi

case "${1:-}" in
	service)
		action="${2:-}"
		case "$action" in
			start|stop|restart|enable|disable|restart_gateway) ;;
			*) fail "Unsupported service action" ;;
		esac
		/etc/init.d/openclaw "$action"
		;;
	autostart)
		# 开机自启总开关: init.d 的 start_service 以 uci openclaw.main.enabled 为准 (为0则拒绝启动),
		# 同时同步 rc.d 自启软链。仅改标志, 不启停当前进程。
		val="${2:-}"
		case "$val" in 0|1) ;; *) fail "Invalid parameter" ;; esac
		uci set openclaw.main.enabled="$val"
		uci commit openclaw
		if [ "$val" = "1" ]; then /etc/init.d/openclaw enable; else /etc/init.d/openclaw disable; fi
		echo "Autostart updated"
		;;
	setup)
		version="${2:-}"
		base="${3:-}"
		node_ver="${4:-}"
		case "$version" in stable|latest) ;; *) fail "Invalid install version" ;; esac
		oc_normalize_install_path "$base" >/dev/null || fail "Invalid install path"
		base=$(oc_normalize_install_path "$base")
		case "$node_ver" in
			""|[0-9]*.[0-9]*.[0-9]*) ;;
			*) fail "Invalid Node.js version format" ;;
		esac
		if ! uci -q get openclaw.main >/dev/null 2>&1; then
			printf "config openclaw 'main'\n\toption enabled '0'\n\toption port '18789'\n\toption bind 'lan'\n\toption token ''\n\toption install_path '/opt'\n" > /etc/config/openclaw
		fi
		uci set openclaw.main.install_path="$base"
		uci commit openclaw
		node_prefix=""
		[ -n "$node_ver" ] && node_prefix=" NODE_VERSION=$(oc_quote "$node_ver")"
		prefix="OC_VERSION=$(oc_quote "$version") OC_INSTALL_PATH=$(oc_quote "$base")${node_prefix}"
		start_task /tmp/openclaw-setup "$prefix /usr/bin/openclaw-env setup; rc=\$?; if [ \$rc -eq 0 ]; then uci set openclaw.main.enabled=1; uci commit openclaw; /etc/init.d/openclaw enable; /etc/init.d/openclaw start; fi; rm -f /tmp/luci-openclaw-status.*; exit \$rc"
		;;
	env-upgrade-openclaw)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 走官方 openclaw update 编排(核心 + 插件 update sync + doctor), 与官方升级一致。
		# 官方在 systemd 上会"停网关→更新→重启"; 在 procd 上 openclaw update 不认得我们的服务(既不停也不重启),
		# 故由我们对齐: 先 procd 停网关, 再 update(--no-restart 跳过其自带服务管理), 完成后 procd 起网关。
		# /usr/bin/openclaw 包装器自动降权到 openclaw 并配好环境。
		# 更新前 chown 修正 home 属主: 历史上若有 root 属主残留(如某插件目录), 以 openclaw 身份的
		# 插件 update 会 EACCES(rename/unlink 失败); 先归位避免插件更新失败。
		cmd="/etc/init.d/openclaw stop; chown -R openclaw:openclaw $(oc_quote "$OC_HOME") 2>/dev/null; /usr/bin/openclaw update --yes --no-restart; rc=\$?; /etc/init.d/openclaw start; rm -f /tmp/luci-openclaw-status.*; exit \$rc"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	env-upgrade-npm)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 原地升级捆绑 npm: NPM_CONFIG_PREFIX 指到 node 目录(否则装到 .npm-global 被 PATH 遮蔽)。
		cmd="su -s /bin/sh openclaw -c $(oc_quote "HOME=$OC_HOME NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP NPM_CONFIG_PREFIX=$NODE_BASE PATH=$NODE_BASE/bin:/usr/sbin:/usr/bin:/sbin:/bin $NODE_BASE/bin/npm install -g npm@latest")"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	env-upgrade-node)
		ver="${2:-}"
		echo "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Invalid Node version format (e.g. 22.22.3)"
		load_paths
		# openclaw-env node <ver> 暂存→校验→替换(失败保留现有 node)。仅成功(rc=0)才 chown + 重启网关;
		# 失败则不重启, 网关继续跑在现有 node 上, 不会把安装搞坏。
		cmd="OC_INSTALL_PATH=$(oc_quote "$OPENCLAW_INSTALL_PATH") /usr/bin/openclaw-env node $(oc_quote "$ver"); rc=\$?; if [ \$rc -eq 0 ]; then chown -R openclaw:openclaw $(oc_quote "$NODE_BASE") 2>/dev/null; /etc/init.d/openclaw restart; fi; rm -f /tmp/luci-openclaw-status.*; exit \$rc"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	uninstall)
		remove_node="${2:-0}"
		case "$remove_node" in 0|1) ;; *) remove_node=0 ;; esac
		start_task /tmp/openclaw-uninstall "/usr/libexec/openclaw-rpc.sh uninstall-task $(oc_quote "$remove_node")"
		;;
	uninstall-task)
		remove_node="${2:-0}"
		load_paths
		oc_safe_openclaw_root "$OC_ROOT" || fail "Install path failed safety validation"
		echo "Stopping OpenClaw service..."
		/etc/init.d/openclaw stop >/dev/null 2>&1 || true
		/etc/init.d/openclaw disable >/dev/null 2>&1 || true
		# 卸载环境只卸"运行时", 保留 /etc/config/openclaw(记住 install_path/port/bind 等便于重装),
		# 仅关闭自启避免空跑。彻底清除配置请用「卸载插件」(opkg remove)。
		uci set openclaw.main.enabled='0' 2>/dev/null || true
		uci commit openclaw 2>/dev/null || true
		echo "Removing runtime..."
		# OC_ROOT 下的软链始终删除；NODE_BASE 下的仅在 remove_node=1 时删除
		for b in node npm npx pnpm corepack; do
			if [ -L "/usr/bin/$b" ]; then
				_target=$(readlink "/usr/bin/$b" 2>/dev/null)
				case "$_target" in
					"$OC_ROOT"/*) rm -f "/usr/bin/$b" ;;
					"$NODE_BASE"/*) [ "$remove_node" = "1" ] && rm -f "/usr/bin/$b" ;;
				esac
			fi
		done
		umount "$OC_ROOT" 2>/dev/null || true
		rm -rf "$OC_ROOT"
		[ ! -d "/overlay/upper$OC_ROOT" ] || rm -rf "/overlay/upper$OC_ROOT"
		if [ "$remove_node" = "1" ]; then
			echo "Removing Node.js runtime..."
			rm -rf "$NODE_BASE"
			[ ! -d "/overlay/upper$NODE_BASE" ] || rm -rf "/overlay/upper$NODE_BASE"
		else
			echo "Node.js runtime kept."
		fi
		# 清理 /tmp 残留: 网关日志目录、各任务文件(本卸载任务自身的 openclaw-uninstall.* 在用, 由 opkg 卸载的 postrm 收尾)、状态/缓存。
		rm -rf /tmp/openclaw 2>/dev/null
		rm -f /tmp/openclaw-setup.* /tmp/openclaw-plugin-upgrade.* /tmp/openclaw-wechat-* /tmp/openclaw-telegram-add.* /tmp/openclaw-doctor-fix.* /tmp/openclaw-env-upgrade.* /var/run/openclaw*.pid /tmp/luci-openclaw-*
		sed -i '/^openclaw:/d' /etc/passwd /etc/shadow /etc/group 2>/dev/null || true
		rm -f /etc/profile.d/openclaw.sh
		echo "OpenClaw runtime uninstalled."
		;;
	upgrade)
		version="${2:-}"
		echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Invalid version format"
		if command -v apk >/dev/null 2>&1 && { [ -d /lib/apk/db ] || [ -d /usr/lib/apk/db ]; }; then
			pkg_url="https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${version}/luci-app-openclaw-${version}-r1.apk"
			i18n_url="https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${version}/luci-i18n-openclaw-zh-cn-${version}-r1.apk"
			pkg_file="/tmp/luci-app-openclaw-update.apk"
			i18n_file="/tmp/luci-i18n-openclaw-zh-cn-update.apk"
			install_cmd="apk add --allow-untrusted $(oc_quote "$pkg_file")"
			i18n_install_cmd="apk add --allow-untrusted $(oc_quote "$i18n_file")"
		elif command -v opkg >/dev/null 2>&1; then
			pkg_url="https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${version}/luci-app-openclaw_${version}-1_all.ipk"
			i18n_url="https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${version}/luci-i18n-openclaw-zh-cn_${version}-1_all.ipk"
			pkg_file="/tmp/luci-app-openclaw-update.ipk"
			i18n_file="/tmp/luci-i18n-openclaw-zh-cn-update.ipk"
			install_cmd="opkg install --force-reinstall $(oc_quote "$pkg_file")"
			i18n_install_cmd="opkg install --force-reinstall $(oc_quote "$i18n_file")"
		else
			fail "No supported package manager found (opkg/apk)"
		fi
		# opkg --force-reinstall 会用包内默认值覆盖 conffile /etc/config/openclaw(install_path/port/bind/token/enabled),
		# apk 升级同样会触发包脚本/配置文件处理。升级前抓取用户当前配置, 在安装完成后还原, 避免设置丢失。
		# 配置不可读时(oip 为空)跳过还原以免清空。
		oip=$(uci -q get openclaw.main.install_path || true)
		oport=$(uci -q get openclaw.main.port || true)
		obind=$(uci -q get openclaw.main.bind || true)
		otok=$(uci -q get openclaw.main.token || true)
		oen=$(uci -q get openclaw.main.enabled || true)
		restore=""
		if [ -n "$oip" ]; then
			restore="uci set openclaw.main.install_path=$(oc_quote "$oip");"
			[ -z "$oport" ] || restore="$restore uci set openclaw.main.port=$(oc_quote "$oport");"
			[ -z "$obind" ] || restore="$restore uci set openclaw.main.bind=$(oc_quote "$obind");"
			# 空 token 交给新包的 uci-defaults 生成，不把生成结果重新清空。
			[ -z "$otok" ] || restore="$restore uci set openclaw.main.token=$(oc_quote "$otok");"
			[ -z "$oen" ] || restore="$restore uci set openclaw.main.enabled=$(oc_quote "$oen");"
			restore="$restore uci commit openclaw;"
		fi
		cmd="curl -fsSL --connect-timeout 15 --max-time 120 -o $(oc_quote "$pkg_file") $(oc_quote "$pkg_url"); rc=\$?; if [ \$rc -ne 0 ]; then echo 'Download failed'; exit \$rc; fi; curl -fsSL --connect-timeout 15 --max-time 120 -o $(oc_quote "$i18n_file") $(oc_quote "$i18n_url") || { echo 'i18n package download failed, skip i18n update'; rm -f $(oc_quote "$i18n_file"); }; $install_cmd; rc=\$?; if [ \$rc -eq 0 ] && [ -f $(oc_quote "$i18n_file") ]; then $i18n_install_cmd || echo 'i18n package install failed, main package upgraded'; fi; rm -f $(oc_quote "$pkg_file") $(oc_quote "$i18n_file"); ${restore} exit \$rc"
		start_task /tmp/openclaw-plugin-upgrade "$cmd"
		;;
	cli-doctor-lint)
		oc_cli_run "doctor --lint --json --non-interactive"
		;;
	cli-health)
		oc_cli_run "health --json --timeout 12000"
		;;
	cli-channels-list)
		oc_cli_run "channels list --json"
		;;
	cli-channels-status)
		oc_cli_run "channels status --json"
		;;
	cli-logs)
		lines="${2:-200}"
		echo "$lines" | grep -Eq '^[0-9]+$' || lines=200
		[ "$lines" -gt 2000 ] && lines=2000
		oc_cli_run "logs --json --plain --limit $lines --timeout 12000"
		;;
	cli-doctor-fix)
		load_paths
		entry=$(find_openclaw_entry) || fail "OpenClaw is not installed"
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		cmd="su -s /bin/sh openclaw -c $(oc_quote "$(oc_cli_env) $NODE_BASE/bin/node $entry doctor --fix --non-interactive --no-workspace-suggestions")"
		start_task /tmp/openclaw-doctor-fix "$cmd"
		;;
	cli-models-set)
		model="${2:-}"
		echo "$model" | grep -Eq '^[A-Za-z0-9._/-]+$' || fail "Invalid model ID"
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 仅改写 agents.defaults.model.primary, 直接写 openclaw.json(实测 0.04s); 网关 file-watcher 自动热重载该键
		# (实测 config hot reload applied), provider 重启在网关内异步进行。
		# 不再同步跑 `openclaw config patch`(实测 6s)或 `openclaw models set`(连慢网关+污染 fallbacks)——
		# 它们经 ucode popen 跑在 rpcd uloop 上, 会阻塞整个 rpcd → LuCI 卡死打不开。
		# model 经严格正则校验, 与文件路径均经 env 传入避免注入; 以 openclaw 身份写, 不产生 root 属主。
		_js='const fs=require("fs"),f=process.env.OC_M_FILE;let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){process.exit(1)}d.agents=(d.agents||{});d.agents.defaults=(d.agents.defaults||{});d.agents.defaults.model=(d.agents.defaults.model||{});d.agents.defaults.model.primary=process.env.OC_M_VAL;fs.writeFileSync(f,JSON.stringify(d,null,2))'
		inner="OC_M_FILE=$(oc_quote "$CONFIG_FILE") OC_M_VAL=$(oc_quote "$model") $NODE_BASE/bin/node -e $(oc_quote "$_js")"
		timeout 30 su -s /bin/sh openclaw -c "$inner" || fail "Failed to write configuration"
		echo "Active model set."
		;;
	cli-models-fallbacks-set)
		# 直接改写 agents.defaults.model.fallbacks(逗号分隔; 空=清空), 绕开官方 configure 向导
		# ——其 allowlist 多选默认勾上已配置模型(含 primary), 会把非-primary 全堆进 fallback。
		# 与 cli-models-set 同款: 直接写 openclaw.json(快, 网关 file-watcher 热重载), 不连网关、不阻塞 rpcd。
		list="${2:-}"
		if [ -n "$list" ]; then
			for m in $(echo "$list" | tr ',' ' '); do
				echo "$m" | grep -Eq '^[A-Za-z0-9._/-]+$' || fail "Invalid fallback model ID"
			done
		fi
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		_js='const fs=require("fs"),f=process.env.OC_F_FILE;const a=(process.env.OC_F_VAL||"").split(",").map(s=>s.trim()).filter(Boolean);let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){process.exit(1)}d.agents=(d.agents||{});d.agents.defaults=(d.agents.defaults||{});d.agents.defaults.model=(d.agents.defaults.model||{});if(a.length)d.agents.defaults.model.fallbacks=a;else delete d.agents.defaults.model.fallbacks;fs.writeFileSync(f,JSON.stringify(d,null,2))'
		inner="OC_F_FILE=$(oc_quote "$CONFIG_FILE") OC_F_VAL=$(oc_quote "$list") $NODE_BASE/bin/node -e $(oc_quote "$_js")"
		timeout 30 su -s /bin/sh openclaw -c "$inner" || fail "Failed to write configuration"
		[ -n "$list" ] && echo "Fallback models updated" || echo "Fallback models cleared"
		;;
	wizard-start)
		# 按需拉起一个 ttyd 实例, 以 openclaw 身份在真实 PTY 中跑官方 configure 向导。
		# 安全模型: 仅绑 br-lan + 随机高端口 + -o 单客户端用完即退 + 命令降权到 openclaw。
		section="${2:-full}"
		case "$section" in model|channels|full|shell) ;; *) fail "Invalid wizard section" ;; esac
		command -v ttyd >/dev/null 2>&1 || fail "ttyd is not installed (opkg install ttyd)"
		load_paths
		find_openclaw_entry >/dev/null 2>&1 || fail "OpenClaw is not installed"
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 杀掉旧实例
		/usr/libexec/openclaw-rpc.sh wizard-stop >/dev/null 2>&1
		uid=$(id -u openclaw); gid=$(id -g openclaw)
		# 随机高端口 (18800-18979); 用 awk 生成 (busybox 无 od)
		rnd=$(awk 'BEGIN{srand(); print int(rand()*180)}' 2>/dev/null)
		echo "$rnd" | grep -Eq '^[0-9]+$' || rnd=$(( $$ % 180 ))
		port=$(( 18800 + rnd ))
		ttyd_bin=$(command -v ttyd || echo /usr/bin/ttyd)
		printf '%s' "$port" > /var/run/openclaw-wizard.port
		# shell 分段: 以 openclaw 身份跑交互式 openclaw-shell (CLI); 其余: 跑官方 configure 向导。
		if [ "$section" = "shell" ]; then
			set -- /usr/bin/openclaw-shell
		else
			set -- /usr/libexec/openclaw-wizard.sh "$section"
		fi
		# 本机无 setsid; 用 nohup 后台启动并脱离 SIGHUP, 使 ttyd 在 rpc.sh 退出后存活。
		nohup "$ttyd_bin" -p "$port" -i br-lan -o -W -u "$uid" -g "$gid" -t fontSize=15 -t disableLeaveAlert=true -T xterm-256color "$@" </dev/null >/dev/null 2>&1 &
		echo $! > /var/run/openclaw-wizard.pid
		# 等 ttyd 监听并把端口回传给调用方 (ucode)。本机 ss 缺失, 用 netstat 检测。
		i=0
		while [ $i -lt 15 ]; do
			netstat -tln 2>/dev/null | grep -q ":${port} " && break
			i=$((i + 1)); sleep 1
		done
		printf '%s' "$port"
		;;
	wizard-stop)
		if [ -f /var/run/openclaw-wizard.pid ]; then
			kill_tree "$(tr -dc '0-9' < /var/run/openclaw-wizard.pid)"
		fi
		# 兜底: 本机无 pkill, 用 pgrep + kill_tree 杀掉残留 ttyd/向导进程树
		for p in $(pgrep -f 'openclaw-wizard.sh' 2>/dev/null) $(pgrep -f 'ttyd .*openclaw-wizard' 2>/dev/null); do
			kill_tree "$p"
		done
		rm -f /var/run/openclaw-wizard.pid /var/run/openclaw-wizard.port
		;;
	wechat-install)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 仅安装插件(不登录, 解耦)。停网关→装插件(openclaw 身份, /usr/bin/openclaw 自动降权)→起网关加载新插件。
		# 登录请另走「扫码登录」(channels login 热重载, 不碰 OpenClaw 自带的网关重启)。
		# 版本由 OpenClaw 官方逻辑(@latest)解析其认定的兼容版本, 不强取 npm raw latest。
		# --force: 已装旧版时替换(install 否则会因 "plugin already exists" 失败);
		# 登录态在 .openclaw/openclaw-weixin/ 单独保存, 不随插件代码替换而丢失。
		# 插件属主由 init.d 的 fix_managed_plugin_ownership 在起网关时归一到 openclaw, 此处无需 chown。
		cmd="/etc/init.d/openclaw stop; /usr/bin/openclaw plugins install --force '@tencent-weixin/openclaw-weixin@latest'; rc=\$?; /usr/bin/openclaw plugins enable openclaw-weixin >/dev/null 2>&1; /etc/init.d/openclaw start; exit \$rc"
		start_task /tmp/openclaw-wechat-install "$cmd"
		;;
	wechat-upgrade)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 走 OpenClaw 官方更新逻辑, 由其解析兼容版本(不强取 npm raw latest); 与「检测升级」用的 --dry-run 同源。
		cmd="/etc/init.d/openclaw stop; /usr/bin/openclaw plugins update openclaw-weixin; rc=\$?; /etc/init.d/openclaw start; exit \$rc"
		start_task /tmp/openclaw-wechat-install "$cmd"
		;;
	wechat-login)
		load_paths
		entry=$(find_openclaw_entry) || fail "OpenClaw is not installed"
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		pkill -f 'channels login --channel openclaw-weixin' 2>/dev/null || true
		rm -f /tmp/openclaw-wechat-qrcode.txt /tmp/openclaw-wechat-login.pid /tmp/openclaw-wechat-login.exit /tmp/openclaw-wechat-restarted
		# 登录前先幂等 enable 插件: OpenClaw 核心升级可能丢掉 plugins.entries.openclaw-weixin,
		# 导致 channels login 退化成交互式"是否安装插件"提问、后台流程答不了而失败。
		cmd="su -s /bin/sh openclaw -c $(oc_quote "export HOME=$OC_HOME OPENCLAW_HOME=$OC_HOME OPENCLAW_STATE_DIR=$OC_STATE_DIR OPENCLAW_CONFIG_PATH=$CONFIG_FILE NPM_CONFIG_PREFIX=$OC_GLOBAL NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP PATH=$NODE_BASE/bin:$OC_GLOBAL/bin:/usr/sbin:/usr/bin:/sbin:/bin; $NODE_BASE/bin/node $entry plugins enable openclaw-weixin >/dev/null 2>&1; $NODE_BASE/bin/node $entry channels login --channel openclaw-weixin"); rc=\$?; if grep -q 'Local login saved auth' /tmp/openclaw-wechat-qrcode.txt; then echo 'WeChat auth saved; restarting OpenClaw service via procd...'; /etc/init.d/openclaw stop >/dev/null 2>&1 || true; /etc/init.d/openclaw start; touch /tmp/openclaw-wechat-restarted; exit 0; fi; exit \$rc"
		start_task /tmp/openclaw-wechat-login "$cmd" /tmp/openclaw-wechat-qrcode.txt
		ln -sf /tmp/openclaw-wechat-qrcode.txt /tmp/openclaw-wechat-login.log
		;;
	wechat-login-cancel)
		cancel_task /tmp/openclaw-wechat-login
		;;
	task-cancel)
		name="${2:-}"
		case "$name" in
			openclaw-setup|openclaw-uninstall|openclaw-plugin-upgrade|openclaw-wechat-install|openclaw-wechat-login|openclaw-doctor-fix) ;;
			*) fail "Invalid task name" ;;
		esac
		cancel_task "/tmp/$name"
		echo "Stopped"
		;;
	wechat-uninstall)
		load_paths
		# 后台任务: 卸载插件耗时较长(node/npm 操作), 同步执行会触发 XHR 超时。
		# 复用安装任务文件, 前端用 wechat_install_log 轮询。
		# OpenClaw 的 plugins uninstall 那步 npm 依赖修剪在 ext4 上会因 rename 撞残留报 ENOTEMPTY、
		# 留下项目目录, 故卸载后直接 rm -rf 插件项目目录兜底, 避免残留累积。
		cmd="/etc/init.d/openclaw stop; /usr/bin/openclaw plugins uninstall --force openclaw-weixin; rc=\$?; rm -rf $(oc_quote "$OC_STATE_DIR")/npm/projects/*openclaw-weixin* 2>/dev/null; /etc/init.d/openclaw start; exit \$rc"
		start_task /tmp/openclaw-wechat-install "$cmd"
		;;
	wechat-logout)
		acquire_operation_lock wechat-logout
		trap 'release_operation_lock' EXIT INT TERM
		load_paths
		account="${2:-}"
		echo "$account" | grep -Eq '^[A-Za-z0-9_.-]+$' || fail "Invalid account ID"
		OC_STATE_DIR="$OC_STATE_DIR" OC_ACCOUNT_ID="$account" "$NODE_BASE/bin/node" -e '
const fs=require("fs"),path=require("path"),state=process.env.OC_STATE_DIR,id=process.env.OC_ACCOUNT_ID;
const wx=path.join(state,"openclaw-weixin"),index=path.join(wx,"accounts.json");
let accounts=[]; try{const value=JSON.parse(fs.readFileSync(index,"utf8"));if(Array.isArray(value))accounts=value;}catch(e){}
if(!accounts.includes(id))process.exit(2);
for(const suffix of [".json",".sync.json",".context-tokens.json"])try{fs.unlinkSync(path.join(wx,"accounts",id+suffix));}catch(e){if(e.code!=="ENOENT")throw e;}
try{fs.unlinkSync(path.join(state,"credentials","openclaw-weixin-"+id+"-allowFrom.json"));}catch(e){if(e.code!=="ENOENT")throw e;}
fs.writeFileSync(index,JSON.stringify(accounts.filter(x=>x!==id),null,2)+"\n");'
		/etc/init.d/openclaw restart >/dev/null 2>&1
		;;
	telegram-add)
		tok="${2:-}"
		echo "$tok" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$' || fail "Invalid Bot Token format"
		load_paths
		entry=$(find_openclaw_entry) || fail "OpenClaw is not installed"
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		# 非交互添加 telegram 渠道(token 已校验, 无 shell 元字符), 完成后 procd 重启生效。
		inner="$(oc_cli_env) $NODE_BASE/bin/node $entry channels add --channel telegram --token $tok"
		cmd="su -s /bin/sh openclaw -c $(oc_quote "$inner"); rc=\$?; /etc/init.d/openclaw restart; exit \$rc"
		start_task /tmp/openclaw-telegram-add "$cmd"
		;;
	telegram-pair)
		code="${2:-}"
		echo "$code" | grep -Eq '^[A-Za-z0-9]{4,16}$' || fail "Invalid pairing code format"
		# --notify: 批准后在 Telegram 里通知发起者已获授权。
		oc_cli_run "pairing approve --channel telegram $(oc_quote "$code") --notify"
		;;
	telegram-pairing-list)
		oc_cli_run "pairing list --channel telegram --json"
		;;
	dm-scope-set)
		val="${2:-}"
		case "$val" in main|per-peer|per-channel-peer|per-account-channel-peer) ;; *) fail "Invalid session scope" ;; esac
		# main = 回到无显式配置(null 删除该键); 其余写显式值。官方 config patch 校验写入(stdin)。
		if [ "$val" = "main" ]; then
			patch='{"session":{"dmScope":null}}'
		else
			patch=$(printf '{"session":{"dmScope":"%s"}}' "$val")
		fi
		printf '%s' "$patch" | oc_cli_run "config patch --stdin" || fail "Failed to write configuration"
		rm -f /tmp/luci-openclaw-status.*
		/etc/init.d/openclaw restart >/dev/null 2>&1 &
		echo "Session isolation saved; gateway is restarting."
		;;
	perm-check)
		load_paths
		[ -d "$OC_ROOT" ] || fail "OpenClaw is not installed"
		find "$OC_ROOT" ! -user openclaw 2>/dev/null | wc -l | tr -d ' '   # 第一行: 数量
		find "$OC_ROOT" ! -user openclaw 2>/dev/null | head -8             # 其余: 示例路径
		;;
	perm-fix)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "The openclaw system user does not exist"
		oc_safe_openclaw_root "$OC_ROOT" || fail "Install path failed safety validation"
		# OpenClaw 以 openclaw 身份运行; root 属主残留会致插件 update EACCES。chown 归位(含符号链接)。
		chown -R openclaw:openclaw "$OC_ROOT" 2>/dev/null
		find "$OC_ROOT" -type l ! -user openclaw -exec chown -h openclaw:openclaw {} + 2>/dev/null
		n=$(find "$OC_ROOT" ! -user openclaw 2>/dev/null | wc -l | tr -d ' ')
		echo "File ownership fixed."
		[ "$n" = "0" ]
		;;
	*) fail "Unknown RPC action" ;;
esac
