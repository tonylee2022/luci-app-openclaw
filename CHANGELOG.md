# 更新记录

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
