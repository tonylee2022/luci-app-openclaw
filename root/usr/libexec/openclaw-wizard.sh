#!/bin/sh
# ============================================================================
# OpenClaw 配置向导包装脚本
# 由 ttyd 在真实 PTY 中、以 openclaw 用户身份运行 (ttyd -u/-g)。
# 直接调用官方 `openclaw configure` 向导, 选项式交互。
#
# 设计要点:
#  - 以 openclaw 身份运行 → 写出的配置天然归 openclaw, 不产生 root 属主文件,
#    避免网关 (openclaw) 重启因 EACCES 起不来。故此处不做 chown。
#  - 不在此重启网关 (procd 需 root, 本进程是 openclaw) → 由网页前端在向导结束后
#    调用 service_action('restart_gateway') 使配置生效。
# ============================================================================
set -u

# 复用 openclaw-rpc.sh 的库函数 (load_paths / find_openclaw_entry / oc_cli_env)
OPENCLAW_RPC_LIBRARY_ONLY=1 . "${OPENCLAW_RPC_HELPER:-/usr/libexec/openclaw-rpc.sh}"

section="${1:-full}"
case "$section" in model|channels|full) ;; *) section="full" ;; esac

load_paths || { echo "安装路径无效"; sleep 3; exit 1; }
entry=$(find_openclaw_entry) || { echo "OpenClaw 未安装, 请先在「基本设置」安装运行环境。"; sleep 3; exit 1; }

run_configure() {
	if [ "$1" = "full" ]; then
		env $(oc_cli_env) node "$entry" configure
	else
		env $(oc_cli_env) node "$entry" configure --section "$1"
	fi
}

clear 2>/dev/null
echo "提示: ↑↓ 移动 · 空格/Tab 选中 · 回车 确认 · Ctrl+C 退出"
echo ""

rc=0
if [ "$section" = "model" ] || [ "$section" = "channels" ]; then
	# model/channels 段单次只配一个, 此处循环以支持连续配置多个 provider/渠道。
	while :; do
		echo "启动官方配置向导 (configure --section ${section}) ..."
		echo ""
		run_configure "$section"
		rc=$?
		echo ""
		[ "$rc" -eq 0 ] || break
		printf "已配置一项。是否再配置一个? [y/N] "
		read -r ans 2>/dev/null || ans=n
		case "$ans" in [Yy]*) clear 2>/dev/null ;; *) break ;; esac
	done
else
	echo "启动官方配置向导 (configure 完整菜单) ..."
	echo ""
	run_configure full
	rc=$?
	echo ""
fi

if [ "$rc" -eq 0 ]; then
	echo "✅ 配置已保存。请回到网页点击「完成并重启网关」使其生效。"
else
	echo "向导已退出 (code: $rc)。如未保存配置, 可重新打开向导。"
fi
sleep 2
exit "$rc"
