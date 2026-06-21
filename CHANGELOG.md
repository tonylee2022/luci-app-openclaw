# 更新记录

## [1.1.5]

- **修复升级后状态概览插件版本陈旧**：插件版本之前被并入 60 秒状态缓存（`/tmp/luci-openclaw-status.*`），升级后概览仍显示旧版本，需多次刷新/等缓存过期才更新。现 `plugin_version` 不再缓存（它只是读 `/usr/share/openclaw/VERSION`，极廉价），每次实时读取，升级后立即正确。
- **状态缓存失效更全面**：插件 postinst 与首次安装(setup)任务完成后均清理 `/tmp/luci-openclaw-status.*`，确保版本/磁盘等信息在安装/升级后立即刷新（此前仅 OpenClaw 升级、换 Node、卸载、会话隔离设置时清理）。

## [1.1.4]

- **修复完全卸载未清理配置**：1.1.3 的卸载清理用了 dpkg 写法 `[ "$1" = "0" ]` 守卫，opkg 并不传该参数（实测 opkg 传 `PKG_UPGRADE=0`、参数 `remove`），导致 postrm 清理分支从不执行——`opkg remove` 后 `/etc/config/openclaw`（及 `-opkg`/`*.bak`）仍残留。改用 opkg 的 `PKG_UPGRADE` 判定：真卸载清理、升级保留。lede 实测：`opkg remove` 后配置/备份全清，升级后配置保留。
- **卸载环境改为保留配置**：「卸载环境」只卸运行时（node/openclaw/用户/软链），现**保留 `/etc/config/openclaw`** 并仅将 `enabled` 置 0——记住 `install_path` 等设置便于重装。彻底清除配置交由「卸载插件」(`opkg remove`)。两者职责分层：卸载环境=卸运行时留配置，卸载插件=全清。

## [1.1.3]

- **修复升级卡死 / 安装后 "Object not found"**：GitHub 发布用的 build_ipk.sh / build_run.sh 的 postinst 之前未重载 rpcd（与 Makefile 不一致），导致升级时旧 postrm 在模块文件缺失空档注销 `luci.openclaw` 对象、而新 postinst 不再注册 → 前端轮询全部失败、界面卡死；命令行全新安装同样报 "Object not found"。现 postinst/安装末尾补 `rpcd reload`（SIGHUP，保留登录会话）。
- **卸载清理**：完全卸载(opkg remove 全删 / LuCI「卸载环境」)时一并清理 `/etc/config/openclaw` 本体、opkg 冲突副本 `-opkg` 与所有 `*.bak` 残留；升级仍保留用户配置。
- 配置合并备份改用固定名 `openclaw.user.bak`，不再每次升级累积时间戳备份。

## [1.1.2]

- **安全 · 网关令牌解耦**：网关认证令牌改由环境变量（`OPENCLAW_GATEWAY_TOKEN` / `gateway run --token`）注入，`openclaw.json` 不再写入明文令牌；令牌仅存于 UCI（不在 OpenClaw 备份范围内）。用户在 OpenClaw 内用 `openclaw secrets` 迁移/抹除 `gateway.auth.token` 不再影响 LuCI 控制台。
- **安全 · 退役 Web PTY 根终端**：移除以 root 监听网络、凭世界可读令牌即得 root shell 的 `web-pty`（及 `oc-config.sh`/`ui` 等遗留资源），消除 `openclaw`→root 本地提权面；配置统一改用以 `openclaw` 身份运行的 ttyd 向导。依赖去掉 `script-utils`。
- **安全 · 移除冗余 `controlUi.allowInsecureAuth`**：该标志仅放宽 localhost，已被 `dangerouslyDisableDeviceAuth` 覆盖，不再写入并清理旧值。
- **SecretRef 兼容**：Telegram 渠道状态在 Bot Token 迁移为 SecretRef 后优雅降级（密钥已托管），不再因读到引用而出错。
- **健康检查 · 密钥明文扫描**：新增 `openclaw secrets audit` 入口，列出明文存储的密钥并引导迁移。
- **消息渠道状态提速**：渠道状态加载由 ~11s 降至 ~4s（减少慢 CLI 调用、`dm_scope` 改读配置文件），无缓存、刷新即实时。
- **版本默认值**：默认 OpenClaw 稳定版 `2026.6.6` → `2026.6.9`；默认 Node.js `24.17.0` → `22.22.3`（最低要求仍为 `22.19.0`）。
- **openclaw-env 整理**：抽出 `_oc_json_set` 复用配置写入逻辑（消除重复内联脚本）；`factory-reset` 复用 `find_oc_entry`，且令牌只写 UCI、不再写明文进 `openclaw.json`（与令牌解耦一致）。
- 文档（README / SECURITY）同步更新安全模型与信任假设。

## [1.1.1]

- 升级 OpenClaw 改用官方 `openclaw update` 编排（核心 + 插件 sync + doctor），对齐官方"停网关→更新→起网关"。
- 「检测升级」综合判断核心与插件：核心已最新但插件/依赖有可用更新时也能升级。
- 更换 Node 版本改为"暂存→校验→替换"：下载/解压失败不再删除现有 node，避免把安装搞坏；失败时不重启网关。
- Telegram 配对助手在授权完成后自动停止。
- 修复安装在 `/root` 等非默认路径时卸载报错（exit 1）：卸载安全校验与安装路径校验对齐。
- 卸载后状态概览不再显示残留的安装路径 / Node.js 路径（未安装时显示「-」）。

## [1.1.0]

- 插件升级改用 `rpcd reload`（SIGHUP）取代 `rpcd restart`：rpcd 原地 re-exec 加载新后端模块，同时 freeze/thaw 保留登录会话，**不再强制重新登录**。
- 升级完成后前端轮询后端恢复并**自动刷新页面**取回新前端（uhttpd 走 ETag 重校验，无需硬刷新），全程无弹窗。
- 打包/卸载钩子（build_ipk.sh postrm、Makefile postinst/postrm）的 rpcd 重启同步改为 reload。

## [1.0.3]

- 状态徽标新增「停止中」（黄色）过渡色，重启/停止流程徽标正确跟随后端实际状态。
- waitForGateway 轮询期间暂停后台 poll，避免干扰徽标显示。
- 安装完成后提示刷新页面再手动点击「启动」，不再自动启动。
- 卸载环境同步删除 `/etc/config/openclaw`。
- 工作区硬约束注入目标改为 `AGENTS.md`（OpenClaw 官方自动加载文件）。
- 安装运行环境版本下拉显示稳定版版本号和 `latest` 标签。
- `openclaw-env node` 支持直接传版本号（如 `openclaw-env node 22.22.3`）。
- Release 发布说明补全 `wget` 下载命令。
- README 优化：清理用户不可见的技术细节，补充 AGENTS.md 注入内容示例。

## [1.0.2]

- 插件「检测升级」改用 IPK 下载安装，取代原来的 .run 自解压执行。
- 修复自升级流程中 rpcd 在任务进程树内同步重启，导致浏览器强制重登录、升级任务中断的问题。
- 检测升级交互完善：有新版弹确认框（含当前版本/新版本对比）；已是最新版显示内联成功提示；检测失败显示内联错误信息。
- 安装完成后在界面内提示用户确认重启后端服务（rpcd），确认后才重启，不再静默操作或强制重登录。
- 新增 rpcd_restart RPC 方法及 ACL 授权，延迟 1 秒重启确保响应先于 rpcd 关闭送达前端。
- 去除所有 LuCI 顶部 banner 通知，所有操作反馈统一在操作区内联状态条显示。

## [1.0.1]

- 微信「安装插件」改为显式解析 npm 最新版并钉住安装（当前 2.4.4）：修复 OpenClaw `plugins install @latest` 退化到旧版（2.4.3）的问题；已安装旧版时用 `--force` 替换为最新版，登录态保留。

## [1.0.0]

- OpenClaw 默认稳定版本设为 `2026.6.6`。
- Node.js 默认版本设为 `22.22.3`，最低版本设为 `22.19.0`。
- 安装、启动、检查统一执行 Node.js 语义版本校验，并在安装后校验 OpenClaw 的 `engines.node`。
- 运行目录统一为 `openclaw/node`、`openclaw/.npm-global`、`openclaw/.npm`、`openclaw/.openclaw` 和 `openclaw/.tmp`。
- 不支持旧目录布局迁移；检测到旧目录或未知文件时停止安装。
- 修正 LuCI、服务、CLI、配置终端、微信插件和构建脚本的目录及环境变量。
- 补齐标准 OpenWrt 包中的交互配置组件。
- ARM64/x64 musl 的 Node.js 运行时统一从 nodejs.org/unofficial-builds 下载，不再自托管自建。
- LuCI 完整迁移为 JavaScript View、`menu.d`、rpcd ucode 和 ACL，不再依赖 `luci-compat`。
- 状态、安装、服务、升级、备份及微信操作统一通过 `luci.openclaw` ubus 对象调用。
- rpcd 接口统一返回 `{ ok, message, data }`，读写方法分别授权；恢复指定备份失败时不回退到其他文件。
- 备份恢复改为暂存目录验证，只允许恢复当前 OpenClaw 状态目录，拒绝路径穿越、链接和其他系统路径。
- 安装、升级、备份、服务及微信操作使用全局互斥锁；token 和安装路径写入探针仅授予写权限。
- 状态轮询降为 10 秒，并缓存静态状态和远程版本检查，降低路由器负载。
- 插件升级在执行下载文件前校验 `.run` 载荷标记。
- 安装和升级时在工作区 `TOOLS.md` 中维护可撤销的 OpenWrt/procd 运行环境说明，保留用户自定义内容。
- 删除代码中无效的 `openclaw gateway stop` 调用，Gateway 生命周期统一交由 init 脚本管理。
- 移除项目对插件启用、白名单、拒绝列表和插件条目的自动修改，完全遵循 OpenClaw 官方机制及用户配置。
