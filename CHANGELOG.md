# 更新记录

## [1.0.0]

- OpenClaw 默认稳定版本设为 `2026.6.6`。
- Node.js 默认版本设为 `22.22.3`，最低版本设为 `22.19.0`。
- 安装、启动、检查统一执行 Node.js 语义版本校验，并在安装后校验 OpenClaw 的 `engines.node`。
- 运行目录统一为 `openclaw/node`、`openclaw/.npm-global`、`openclaw/.npm`、`openclaw/.openclaw` 和 `openclaw/.tmp`。
- 不支持旧目录布局迁移；检测到旧目录或未知文件时停止安装。
- 修正 LuCI、服务、CLI、配置终端、微信插件和构建脚本的目录及环境变量。
- 补齐标准 OpenWrt 包中的交互配置组件。
- Node.js ARM64 musl 构建仅生成当前支持版本。
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
