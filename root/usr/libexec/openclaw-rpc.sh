#!/bin/sh
set -u

. "${OPENCLAW_PATHS_HELPER:-/usr/libexec/openclaw-paths.sh}"
. "${OPENCLAW_BACKUP_HELPER:-/usr/libexec/openclaw-backup.sh}"

OPERATION_LOCK="${OPENCLAW_OPERATION_LOCK:-/var/lock/openclaw-operation.lock}"

fail() {
	echo "$1" >&2
	exit 1
}

load_paths() {
	base=$(uci -q get openclaw.main.install_path || echo /opt)
	oc_load_paths "$base" || fail "UCI 安装路径无效"
	# 备份目录可经 UCI 覆盖, 但必须在安装根目录之外; 非法值静默回退到默认 OC_BACKUP_DIR。
	bp=$(uci -q get openclaw.main.backup_path || true)
	if [ -n "${bp:-}" ]; then
		bp=$(oc_normalize_backup_dir "$bp") && OC_BACKUP_DIR="$bp"
	fi
	export OC_BACKUP_DIR
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
	operation_locked && fail "另一项 OpenClaw 系统操作正在进行"
	mkdir "$OPERATION_LOCK" 2>/dev/null || fail "另一项 OpenClaw 系统操作正在进行"
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
		fail "已有同类任务正在运行"
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
oc_cli_env() {
	printf '%s' "HOME=$OC_HOME OPENCLAW_HOME=$OC_HOME OPENCLAW_STATE_DIR=$OC_STATE_DIR OPENCLAW_CONFIG_PATH=$CONFIG_FILE NPM_CONFIG_PREFIX=$OC_GLOBAL NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP PATH=$NODE_BASE/bin:$OC_GLOBAL/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

# 同步执行一条 openclaw CLI 子命令并把 stdout 原样输出 (供 ucode json 解析)。
# 用法: oc_cli_run "doctor --lint --json"
oc_cli_run() {
	load_paths
	entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
	id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
	# 直接交给 su -c (单层解析), 此处不可用 oc_quote, 否则单引号会成为字面量。
	su -s /bin/sh openclaw -c "$(oc_cli_env) $NODE_BASE/bin/node $entry $1"
}

if [ "${OPENCLAW_RPC_LIBRARY_ONLY:-0}" = "1" ]; then
	return 0 2>/dev/null || exit 0
fi

case "${1:-}" in
	service)
		action="${2:-}"
		case "$action" in
			start|stop|restart|enable|disable|restart_gateway) ;;
			*) fail "不支持的服务操作" ;;
		esac
		/etc/init.d/openclaw "$action"
		;;
	autostart)
		# 开机自启总开关: init.d 的 start_service 以 uci openclaw.main.enabled 为准 (为0则拒绝启动),
		# 同时同步 rc.d 自启软链。仅改标志, 不启停当前进程。
		val="${2:-}"
		case "$val" in 0|1) ;; *) fail "参数无效" ;; esac
		uci set openclaw.main.enabled="$val"
		uci commit openclaw
		if [ "$val" = "1" ]; then /etc/init.d/openclaw enable; else /etc/init.d/openclaw disable; fi
		echo "已更新开机自启"
		;;
	backup-path-set)
		load_paths
		# 当前生效目录 = OC_BACKUP_DIR(load_paths 已应用 UCI 覆盖)。
		from="$OC_BACKUP_DIR"
		val="${2:-}"
		if [ -z "$val" ]; then
			target="$OC_BACKUP_DIR_DEFAULT"
		else
			target=$(oc_normalize_backup_dir "$val") || fail "备份路径无效: 需为绝对路径且位于安装目录之外"
		fi
		if [ "$target" != "$from" ]; then
			mkdir -p "$target" || fail "无法创建备份目录: $target"
			chown openclaw:openclaw "$target" 2>/dev/null || true
			# 迁移已有备份到新目录, 保持列表连续。
			mv "$from"/*-openclaw-backup.tar.gz "$target/" 2>/dev/null || true
		fi
		if [ -z "$val" ]; then
			uci -q delete openclaw.main.backup_path
			uci commit openclaw
			echo "已恢复默认备份路径: $target"
		else
			uci set openclaw.main.backup_path="$target"
			uci commit openclaw
			echo "备份路径已设为: $target"
		fi
		;;
	setup)
		version="${2:-}"
		base="${3:-}"
		case "$version" in stable|latest) ;; *) fail "安装版本无效" ;; esac
		oc_normalize_install_path "$base" >/dev/null || fail "安装路径无效"
		base=$(oc_normalize_install_path "$base")
		uci set openclaw.main.install_path="$base"
		uci commit openclaw
		prefix="OC_VERSION=$(oc_quote "$version") OC_INSTALL_PATH=$(oc_quote "$base")"
		start_task /tmp/openclaw-setup "$prefix /usr/bin/openclaw-env setup; rc=\$?; if [ \$rc -eq 0 ]; then uci set openclaw.main.enabled=1; uci commit openclaw; /etc/init.d/openclaw enable; /etc/init.d/openclaw start; fi; exit \$rc"
		;;
	env-upgrade-openclaw)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		# 以 openclaw 身份升级 OpenClaw 到最新版(写入 .npm-global), 完成后 procd 重启使新版本生效。
		cmd="su -s /bin/sh openclaw -c $(oc_quote "$(oc_cli_env) $NODE_BASE/bin/npm install -g openclaw@latest"); rc=\$?; /etc/init.d/openclaw restart; rm -f /tmp/luci-openclaw-status.*; exit \$rc"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	env-upgrade-npm)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		# 原地升级捆绑 npm: NPM_CONFIG_PREFIX 指到 node 目录(否则装到 .npm-global 被 PATH 遮蔽)。
		cmd="su -s /bin/sh openclaw -c $(oc_quote "HOME=$OC_HOME NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP NPM_CONFIG_PREFIX=$NODE_BASE PATH=$NODE_BASE/bin:/usr/sbin:/usr/bin:/sbin:/bin $NODE_BASE/bin/npm install -g npm@latest")"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	env-upgrade-node)
		ver="${2:-}"
		echo "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Node 版本号格式无效 (如 22.22.3)"
		load_paths
		# openclaw-env node <ver> 下载/解压到 NODE_BASE(root 运行), 完成后 chown 给 openclaw + 重启网关。
		cmd="OC_INSTALL_PATH=$(oc_quote "$OPENCLAW_INSTALL_PATH") /usr/bin/openclaw-env node $(oc_quote "$ver"); rc=\$?; chown -R openclaw:openclaw $(oc_quote "$NODE_BASE") 2>/dev/null; /etc/init.d/openclaw restart; rm -f /tmp/luci-openclaw-status.*; exit \$rc"
		start_task /tmp/openclaw-env-upgrade "$cmd"
		;;
	uninstall)
		start_task /tmp/openclaw-uninstall "/usr/libexec/openclaw-rpc.sh uninstall-task"
		;;
	uninstall-task)
		load_paths
		oc_safe_openclaw_root "$OC_ROOT" || fail "安装路径未通过安全校验"
		echo "正在停止 OpenClaw 服务..."
		/etc/init.d/openclaw stop >/dev/null 2>&1 || true
		/etc/init.d/openclaw disable >/dev/null 2>&1 || true
		uci delete openclaw.main 2>/dev/null || true
		uci commit openclaw 2>/dev/null || true
		rm -f /etc/config/openclaw
		echo "正在删除运行环境: $OC_ROOT"
		# 删除指向本安装目录的 node 工具软链 (仅删指向 $OC_ROOT 的, 不动系统 node)
		for b in node npm npx pnpm corepack; do
			if [ -L "/usr/bin/$b" ]; then
				case "$(readlink "/usr/bin/$b" 2>/dev/null)" in
					"$OC_ROOT"/*) rm -f "/usr/bin/$b" ;;
				esac
			fi
		done
		umount "$OC_ROOT" 2>/dev/null || true
		rm -rf "$OC_ROOT"
		[ ! -d "/overlay/upper$OC_ROOT" ] || rm -rf "/overlay/upper$OC_ROOT"
		rm -f /tmp/openclaw-setup.* /tmp/openclaw-plugin-upgrade.* /tmp/openclaw-wechat-* /var/run/openclaw*.pid
		sed -i '/^openclaw:/d' /etc/passwd /etc/shadow /etc/group 2>/dev/null || true
		rm -f /etc/profile.d/openclaw.sh
		echo "OpenClaw 运行环境已卸载。"
		;;
	upgrade)
		version="${2:-}"
		echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "版本号格式无效"
		url="https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${version}/luci-app-openclaw_${version}-1_all.ipk"
		cmd="curl -fsSL --connect-timeout 15 --max-time 120 -o /tmp/luci-app-openclaw-update.ipk $(oc_quote "$url"); rc=\$?; if [ \$rc -ne 0 ]; then echo '下载失败'; exit \$rc; fi; opkg install --force-reinstall /tmp/luci-app-openclaw-update.ipk; rc=\$?; rm -f /tmp/luci-app-openclaw-update.ipk; exit \$rc"
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
		entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		cmd="su -s /bin/sh openclaw -c $(oc_quote "$(oc_cli_env) $NODE_BASE/bin/node $entry doctor --fix --non-interactive --no-workspace-suggestions")"
		start_task /tmp/openclaw-doctor-fix "$cmd"
		;;
	cli-models-set)
		model="${2:-}"
		echo "$model" | grep -Eq '^[A-Za-z0-9._/-]+$' || fail "模型 ID 无效"
		oc_cli_run "models set $(oc_quote "$model")"
		;;
	wizard-start)
		# 按需拉起一个 ttyd 实例, 以 openclaw 身份在真实 PTY 中跑官方 configure 向导。
		# 安全模型: 仅绑 br-lan + 随机高端口 + -o 单客户端用完即退 + 命令降权到 openclaw。
		section="${2:-full}"
		case "$section" in model|channels|full|shell) ;; *) fail "无效的向导分段" ;; esac
		command -v ttyd >/dev/null 2>&1 || fail "ttyd 未安装 (opkg install ttyd)"
		load_paths
		find_openclaw_entry >/dev/null 2>&1 || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
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
		nohup "$ttyd_bin" -p "$port" -i br-lan -o -u "$uid" -g "$gid" -t fontSize=15 -t disableLeaveAlert=true -T xterm-256color "$@" </dev/null >/dev/null 2>&1 &
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
	backup-create)
		acquire_operation_lock backup-create
		trap 'release_operation_lock' EXIT INT TERM
		load_paths
		only_config="${2:-1}"
		case "$only_config" in 0|1) ;; *) fail "备份类型无效" ;; esac
		entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		mkdir -p "$OC_BACKUP_DIR"
		chown openclaw:openclaw "$OC_BACKUP_DIR" 2>/dev/null || true
		# 迁移历史版本遗留在安装路径内的备份, 避免卸载丢失。
		mv "$OC_STATE_DIR"/backups/*-openclaw-backup.tar.gz "$OC_BACKUP_DIR/" 2>/dev/null || true
		args="backup create --no-include-workspace"
		[ "$only_config" = 0 ] || args="$args --only-config"
		run_home="$OC_HOME"
		[ "$only_config" = 1 ] || run_home="$OC_BACKUP_DIR"
		# 必须以 openclaw 身份运行: 以 root 运行会触发 OpenClaw 临时目录安全校验失败(openclaw-0), 并产生 root 属主文件。
		su -s /bin/sh openclaw -c "cd $(oc_quote "$OC_BACKUP_DIR") && HOME=$(oc_quote "$run_home") OPENCLAW_HOME=$(oc_quote "$OC_HOME") OPENCLAW_STATE_DIR=$(oc_quote "$OC_STATE_DIR") OPENCLAW_CONFIG_PATH=$(oc_quote "$CONFIG_FILE") NPM_CONFIG_PREFIX=$(oc_quote "$OC_GLOBAL") NPM_CONFIG_CACHE=$(oc_quote "$OC_NPM_CACHE") TMPDIR=$(oc_quote "$OC_TMP") $NODE_BASE/bin/node $entry $args"
		mv "$OC_HOME"/*-openclaw-backup.tar.gz "$OC_BACKUP_DIR/" 2>/dev/null || true
		chown openclaw:openclaw "$OC_BACKUP_DIR"/*-openclaw-backup.tar.gz 2>/dev/null || true
		;;
	backup-verify)
		acquire_operation_lock backup-verify
		trap 'release_operation_lock' EXIT INT TERM
		load_paths
		file="${2:-}"
		if [ -z "$file" ]; then
			file=$(ls -t "$OC_BACKUP_DIR"/*-openclaw-backup.tar.gz 2>/dev/null | head -1)
		else
			echo "$file" | grep -Eq '^[A-Za-z0-9._+-]+-openclaw-backup\.tar\.gz$' || fail "备份文件名无效"
			file="$OC_BACKUP_DIR/$file"
		fi
		[ -f "$file" ] || fail "备份文件不存在"
		entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		# 以 openclaw 身份运行(带 env), 否则 root 触发临时目录安全校验失败。
		su -s /bin/sh openclaw -c "$(oc_cli_env) $NODE_BASE/bin/node $entry backup verify $(oc_quote "$file")"
		;;
	backup-delete)
		acquire_operation_lock backup-delete
		trap 'release_operation_lock' EXIT INT TERM
		load_paths
		file="${2:-}"
		echo "$file" | grep -Eq '^[A-Za-z0-9._+-]+-openclaw-backup\.tar\.gz$' || fail "备份文件名无效"
		[ -f "$OC_BACKUP_DIR/$file" ] || fail "备份文件不存在"
		rm -f "$OC_BACKUP_DIR/$file"
		;;
	backup-restore)
		acquire_operation_lock backup-restore
		trap 'release_operation_lock' EXIT INT TERM
		load_paths
		file="${2:-}"
		echo "$file" | grep -Eq '^[A-Za-z0-9._+-]+-openclaw-backup\.tar\.gz$' || fail "备份文件名无效"
		archive="$OC_BACKUP_DIR/$file"
		[ -f "$archive" ] || fail "备份文件不存在"
		restore_stage=$(mktemp -d "${OC_TMP:-/tmp}/openclaw-restore.XXXXXX") || fail "无法创建恢复临时目录"
		trap 'rm -rf "$restore_stage"; release_operation_lock' EXIT INT TERM
		restore_source=$(oc_prepare_backup_restore "$archive" "$OC_STATE_DIR" "$restore_stage") || fail "备份包含不安全路径、链接或非状态目录内容"
		[ -f "$restore_source/openclaw.json" ] || fail "备份中缺少 openclaw.json"
		"$NODE_BASE/bin/node" -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$restore_source/openclaw.json" || fail "备份配置无效"
		cp -f "$CONFIG_FILE" "$CONFIG_FILE.pre-restore" 2>/dev/null || true
		/etc/init.d/openclaw stop >/dev/null 2>&1 || true
		mkdir -p "$OC_STATE_DIR"
		cp -a "$restore_source/." "$OC_STATE_DIR/"
		chown -R openclaw:openclaw "$OC_STATE_DIR" 2>/dev/null || true
		/etc/init.d/openclaw start >/dev/null 2>&1 &
		;;
	wechat-install)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		# 仅安装插件(不登录, 解耦)。停网关→装插件(openclaw 身份, /usr/bin/openclaw 自动降权)→起网关加载新插件。
		# 登录请另走「扫码登录」(channels login 热重载, 不碰 OpenClaw 自带的网关重启)。
		# 显式解析 npm 最新版后钉住安装: OpenClaw 的 plugins install @latest 会退化到旧版
		# (实测 @latest→2.4.3, 而 npm latest=2.4.4), 与官方 cli 一致地取 npm 真正 latest。
		ver=$(su -s /bin/sh openclaw -c "$(oc_cli_env) $NODE_BASE/bin/npm view @tencent-weixin/openclaw-weixin version 2>/dev/null" | tr -d '[:space:]')
		echo "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || ver=latest
		# --force: 已装旧版时替换为解析出的最新版(install 否则会因 "plugin already exists" 失败);
		# 登录态在 .openclaw/openclaw-weixin/ 单独保存, 不随插件代码替换而丢失。
		cmd="/etc/init.d/openclaw stop; /usr/bin/openclaw plugins install --force '@tencent-weixin/openclaw-weixin@${ver}'; rc=\$?; /usr/bin/openclaw plugins enable openclaw-weixin >/dev/null 2>&1; /etc/init.d/openclaw start; exit \$rc"
		start_task /tmp/openclaw-wechat-install "$cmd"
		;;
	wechat-upgrade)
		load_paths
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		cmd="/etc/init.d/openclaw stop; /usr/bin/openclaw plugins update openclaw-weixin; rc=\$?; /etc/init.d/openclaw start; exit \$rc"
		start_task /tmp/openclaw-wechat-install "$cmd"
		;;
	wechat-login)
		load_paths
		entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		pkill -f 'channels login --channel openclaw-weixin' 2>/dev/null || true
		rm -f /tmp/openclaw-wechat-qrcode.txt /tmp/openclaw-wechat-login.pid /tmp/openclaw-wechat-login.exit /tmp/openclaw-wechat-restarted
		# 登录前先幂等 enable 插件: OpenClaw 核心升级可能丢掉 plugins.entries.openclaw-weixin,
		# 导致 channels login 退化成交互式"是否安装插件"提问、后台流程答不了而失败。
		cmd="su -s /bin/sh openclaw -c $(oc_quote "export HOME=$OC_HOME OPENCLAW_HOME=$OC_HOME OPENCLAW_STATE_DIR=$OC_STATE_DIR OPENCLAW_CONFIG_PATH=$CONFIG_FILE NPM_CONFIG_PREFIX=$OC_GLOBAL NPM_CONFIG_CACHE=$OC_NPM_CACHE TMPDIR=$OC_TMP PATH=$NODE_BASE/bin:$OC_GLOBAL/bin:/usr/sbin:/usr/bin:/sbin:/bin; $NODE_BASE/bin/node $entry plugins enable openclaw-weixin >/dev/null 2>&1; $NODE_BASE/bin/node $entry channels login --channel openclaw-weixin"); rc=\$?; if grep -q 'Local login saved auth' /tmp/openclaw-wechat-qrcode.txt; then echo '微信认证已保存，正在通过 procd 重启 OpenClaw 服务...'; /etc/init.d/openclaw stop >/dev/null 2>&1 || true; /etc/init.d/openclaw start; touch /tmp/openclaw-wechat-restarted; exit 0; fi; exit \$rc"
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
			*) fail "无效的任务名" ;;
		esac
		cancel_task "/tmp/$name"
		echo "已停止"
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
		echo "$account" | grep -Eq '^[A-Za-z0-9_.-]+$' || fail "账号 ID 无效"
		OC_STATE_DIR="$OC_STATE_DIR" OC_ACCOUNT_ID="$account" "$NODE_BASE/bin/node" -e '
const fs=require("fs"),path=require("path"),state=process.env.OC_STATE_DIR,id=process.env.OC_ACCOUNT_ID;
const wx=path.join(state,"openclaw-weixin"),index=path.join(wx,"accounts.json");
let accounts=[]; try{const value=JSON.parse(fs.readFileSync(index,"utf8"));if(Array.isArray(value))accounts=value;}catch(e){}
if(!accounts.includes(id))process.exit(2);
for(const suffix of [".json",".sync.json",".context-tokens.json"])try{fs.unlinkSync(path.join(wx,"accounts",id+suffix));}catch(e){if(e.code!=="ENOENT")throw e;}
try{fs.unlinkSync(path.join(state,"credentials","openclaw-weixin-"+id+"-allowFrom.json"));}catch(e){if(e.code!=="ENOENT")throw e;}
fs.writeFileSync(index,JSON.stringify(accounts.filter(x=>x!==id),null,2)+"\n");'
		/etc/init.d/openclaw restart >/dev/null 2>&1 &
		;;
	telegram-add)
		tok="${2:-}"
		echo "$tok" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$' || fail "Bot Token 格式无效"
		load_paths
		entry=$(find_openclaw_entry) || fail "OpenClaw 未安装"
		id openclaw >/dev/null 2>&1 || fail "openclaw 系统用户不存在"
		# 非交互添加 telegram 渠道(token 已校验, 无 shell 元字符), 完成后 procd 重启生效。
		inner="$(oc_cli_env) $NODE_BASE/bin/node $entry channels add --channel telegram --token $tok"
		cmd="su -s /bin/sh openclaw -c $(oc_quote "$inner"); rc=\$?; /etc/init.d/openclaw restart; exit \$rc"
		start_task /tmp/openclaw-telegram-add "$cmd"
		;;
	telegram-pair)
		code="${2:-}"
		echo "$code" | grep -Eq '^[A-Za-z0-9]{4,16}$' || fail "配对码格式无效"
		oc_cli_run "pairing approve --channel telegram $(oc_quote "$code")"
		;;
	telegram-pairing-list)
		oc_cli_run "pairing list --channel telegram --json"
		;;
	*) fail "未知 RPC 操作" ;;
esac
