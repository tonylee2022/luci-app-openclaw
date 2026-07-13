# luci-app-openclaw

[简体中文](README.md) | [English](README_EN.md)

[![Build & Release](https://github.com/tonylee2022/luci-app-openclaw/actions/workflows/build.yml/badge.svg)](https://github.com/tonylee2022/luci-app-openclaw/actions/workflows/build.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

OpenClaw AI 网关的 OpenWrt / iStoreOS LuCI 管理插件。

在路由器上运行 OpenClaw，并通过 LuCI 图形界面完成运行环境安装、服务管理、模型/渠道配置与升级。OpenClaw 始终以非 root 的 `openclaw` 用户运行。

<div align="center">
  <img src="docs/images/overview.png" alt="OpenClaw LuCI 基本设置" width="900" style="border-radius:8px;" />
</div>

## 🖼 界面截图

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/images/wizard.png" alt="官方配置 / openclaw-shell" width="100%" /><br/><sub><b>配置管理 · 官方配置</b>：网页内嵌真实终端运行官方向导，或一键进入 openclaw-shell 命令行。</sub></td>
    <td width="50%" valign="top"><img src="docs/images/providers.png" alt="模型与提供商" width="100%" /><br/><sub><b>配置管理 · 提供商</b>：已配置提供商（授权方式 / 模型数），可设置活跃模型。</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img src="docs/images/channels.png" alt="消息渠道" width="100%" /><br/><sub><b>配置管理 · 渠道</b>：微信扫码登录、Telegram Bot Token 配置与配对。</sub></td>
    <td width="50%" valign="top"><img src="docs/images/console.png" alt="Web 控制台" width="100%" /><br/><sub><b>Web 控制台</b>：内嵌 OpenClaw 官方管理界面，直接对话与管理。</sub></td>
  </tr>
</table>

## ✨ 功能特性

### 基本设置（服务 → OpenClaw → 基本设置）
- **状态概览**：运行状态徽标（运行中 / 启动中 / 已停止）、开机自启（可一键切换）、网关端口、活跃模型、消息渠道、PID、内存、Node.js / OpenClaw / 插件版本、安装路径、剩余空间。
- **快捷操作**：安装运行环境、启动 / 重启 / 仅重启网关 / 停止、切换开机自启、插件升级、环境升级、卸载环境。每个操作点击即在信息栏提示进度，长任务带实时日志面板。
- **安装运行环境**：自动列出可用磁盘挂载点及可用空间，选择安装位置 + 版本（稳定版/最新版），安装前做容量与写入权限检查。
- **环境升级**：升级 OpenClaw 到最新版、更新内置 npm、升级指定版本 Node.js（升级后自动重启网关）。
- **快速指南** 与项目链接。

### 配置管理（服务 → OpenClaw → 配置管理）
- **官方配置**：在网页内嵌的真实终端（ttyd）里以 `openclaw` 身份运行官方 `openclaw configure` 向导；或一键进入 **openclaw-shell** 命令行，直接敲 CLI 配置/交互，面板内含「重启网关」并就地显示完整重启进度。
- **提供商**：展示已配置提供商（授权方式、已配置模型数）；「设置活跃模型」从已配置模型中选择并切换默认模型。
- **渠道**：仅列出已配置渠道。
  - **微信渠道**：安装插件 / 扫码登录（清晰可扫的二维码）/ 检测升级 / 卸载 / 已登录账号管理。
  - **Telegram 渠道**：填入 Bot Token 一键配置；并提供**配对**：填配对码审批私信发起者 / 查看待配对请求。
- **健康检查**：运行 `openclaw doctor`（lint / 一键修复）；**文件权属**检查与一键修复（修正 root 属主残留导致的插件更新 EACCES）；**密钥明文扫描**（`openclaw secrets audit`，列出 `openclaw.json` / auth-profiles 中以明文存储的密钥，引导在终端用 `openclaw secrets configure` 迁移为 SecretRef）。
- **日志**：网关日志查看（行数 50/100/200、加载、清空、2 秒自动刷新）。

### 其它
- **Web 控制台**：嵌入 OpenClaw 控制台。
- **主题适配**：插件自带明/暗两套样式，跟随当前 LuCI 主题（如 Argon）的明暗自动切换。
- **中英双语**：界面、菜单与操作反馈支持简体中文 / English，随 LuCI 界面语言自动切换（标准 LuCI i18n，语言包 `po/zh_Hans/`，安装为 `usr/lib/lua/luci/i18n/openclaw.zh-cn.lmo`）。注：网页内嵌终端（官方配置向导 / openclaw-shell）由 ttyd 运行，其输出不随界面语言切换。
- **安全模型**：OpenClaw 以 `openclaw` 系统用户运行；`openclaw` / `openclaw-shell` 在以 root 调用时自动降权到正确用户身份。

## 系统要求

| 项目 | 要求 |
|------|------|
| 固件 | OpenWrt **23.05+** 及其衍生版（LEDE / ImmortalWrt / iStoreOS 等）；23.05-24.10 使用 `.ipk`，25.12+ 使用 `.apk` |
| 架构 | x86_64 或 aarch64 (ARM64) |
| C 库 | musl（自动检测） |
| 依赖 | luci-base、rpcd-mod-ucode、curl、openssl-util、tar、ttyd、qrencode、libstdcpp |
| 存储 | **2GB 以上可用空间** |
| 内存 | 推荐 1GB 及以上 |

## 当前适配版本

| 组件 | 默认版本 | 说明 |
|------|----------|------|
| OpenClaw | `2026.6.9` | 默认安装版本；可选「最新版」 |
| Node.js | `22.22.3` | 最低要求 `22.19.0` |
| 微信插件 | 官方兼容版本 | `@tencent-weixin/openclaw-weixin@latest` |

## 📦 安装

### 方式一：.run 自解压包（推荐）

无需 SDK，适用于已安装好的系统。

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw_${VER}.run"
sh "luci-app-openclaw_${VER}.run"
```

### 方式二：OpenWrt 23.05-24.10 / `.ipk` 安装

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw_${VER}-1_all.ipk"
opkg install "luci-app-openclaw_${VER}-1_all.ipk"
```

### 方式三：OpenWrt 25.12+ / `.apk` 安装

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw-${VER}-1.apk"
apk add --allow-untrusted "luci-app-openclaw-${VER}-1.apk"
```

### 方式四：集成到固件编译

```bash
cd /path/to/openwrt
echo "src-git openclaw https://github.com/tonylee2022/luci-app-openclaw.git" >> feeds.conf.default
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # LuCI → Applications → luci-app-openclaw
make package/luci-app-openclaw/compile V=s
```

## 🔰 首次使用

1. 打开 LuCI → **服务 → OpenClaw → 基本设置**，点击「安装运行环境」，选择有 ≥2GB 空间的挂载点与版本，等待安装完成后**刷新页面**，再点击「启动」按钮启动服务。
2. 到 **配置管理 → 官方配置**，用「官方配置向导」或「openclaw-shell」添加提供商与 API Key。
3. 到 **配置管理 → 渠道** 配置消息渠道：微信（安装插件 → 扫码登录）、Telegram（填 Bot Token → 配对）。
4. 配置改动后点「重启」/「重启网关」使其生效；状态徽标显示「运行中」即正常。

## 命令行使用

SSH 进入路由器后，可用以下命令（均以 `openclaw` 用户身份运行）：

```bash
openclaw-shell                  # 进入隔离的 openclaw 用户子 Shell（exit 退出）
openclaw-env check              # 检查运行环境
openclaw-env upgrade            # 升级 OpenClaw 到最新版
openclaw-env node [x.y.z]       # 安装/更新 Node.js（不加版本号则使用默认版本）
```

自定义安装路径时，可为单次命令设置 `OPENCLAW_INSTALL_PATH`：

```bash
OPENCLAW_INSTALL_PATH=/mnt/data openclaw-shell
```

## 自定义安装路径

UCI 字段为 `openclaw.main.install_path`，实际运行目录固定展开为 `<基础目录>/openclaw`：

```bash
uci set openclaw.main.install_path='/mnt/data'
uci commit openclaw
openclaw-env setup
```

安装后的目录布局：

```text
/mnt/data/openclaw/
├── node/          # Node.js 运行时
├── .npm-global/   # OpenClaw、pnpm 等全局 npm 包
├── .npm/          # npm 缓存
├── .openclaw/     # OpenClaw 配置、状态、会话和插件
└── .tmp/          # npm/插件运行临时目录
```

磁盘已满、只读或外置盘未挂载时，安装前会提示失败；安装目录已有未知文件时会停止并提示清理后再试。

## 🤖 AI 工作区集成

安装完成后，插件会自动在 OpenClaw 工作区的 `AGENTS.md` 中写入本机部署信息，包括运行目录路径和权限边界。AI 由此了解哪些操作（如重启服务）需要通过 LuCI 界面或 root 完成，而不会在自身权限之外反复尝试。

注入内容如下（`$OC_HOME` 等变量在运行时展开为实际路径）：

```
<!-- luci-app-openclaw:openwrt-runtime:start -->
## 7. 部署环境硬约束（由 luci-app-openclaw 注入，禁止手动编辑此区块）

本实例由 luci-app-openclaw 部署，Gateway 进程由 OpenWrt procd 以 root 身份管理。
`openclaw` 用户**没有权限**执行 init 脚本或控制服务生命周期，不要尝试。

需要重启服务或 Gateway 时：告知**用户**通过 LuCI 界面操作，或以 root 身份 SSH 执行。

运行目录（只读参考，不要修改）：

- OpenClaw HOME: `/opt/openclaw`
- OpenClaw state: `/opt/openclaw/.openclaw`
- npm prefix: `/opt/openclaw/.npm-global`
- npm cache: `/opt/openclaw/.npm`
- temporary files: `/opt/openclaw/.tmp`
<!-- luci-app-openclaw:openwrt-runtime:end -->
```

（路径以默认 `/opt` 为例，实际值跟随用户安装目录。）

工作区中你自己编写的内容不受影响；插件只维护其专属的标记区块，升级时自动更新。

## 🔒 安全模型

- **非 root 运行**：OpenClaw 始终以 `openclaw` 系统用户运行；`/usr/bin/openclaw` 与 `openclaw-shell` 在被 root 调用时自动降权，配置向导终端（ttyd）以 `openclaw` 身份运行并绑定 `br-lan`（仅 LAN 可达）。
- **网关令牌解耦**：网关认证令牌存于 UCI（`/etc/config/openclaw`，不在 OpenClaw 状态目录及其私有 Git 历史中），运行时经环境变量（`OPENCLAW_GATEWAY_TOKEN` / `gateway run --token`）注入网关与 CLI。`openclaw.json` **不再写入明文令牌**——因此用户在 OpenClaw 内用 `openclaw secrets configure/apply` 迁移或抹除 `gateway.auth.token` 时，env 注入优先生效，LuCI 控制台与各功能不受影响。
- **SecretRef 兼容**：Telegram 等渠道状态在密钥被迁移为 SecretRef（密钥已托管）后能优雅降级显示，不会因读到引用而出错；健康检查提供「密钥明文扫描」引导迁移。
- **配置终端**：早期以 root 监听网络的 Web PTY（`web-pty`）已**退役**（它曾构成 `openclaw`→root 本地提权面）；配置统一改用以 `openclaw` 身份、绑 `br-lan` 的 ttyd 向导。
- **Web 控制台的信任假设**：内嵌的 OpenClaw 控制台经 LAN、HTTP 访问，为此放宽了网关的设备认证与来源校验，意味着**信任 LAN 内的访问者**——请勿将网关端口（默认 18789）暴露到 WAN。详见 [SECURITY.md](SECURITY.md)。
- **插件策略不干预**：插件的启用、禁用、白名单、拒绝列表等策略完全由 OpenClaw 官方机制与用户配置管理，本项目不干预（微信渠道的用户驱动安装/启用/卸载除外）。

## 📜 版权与开源声明

本项目以 [GPL-3.0](LICENSE) 许可证开源。

- © 2026 [tonylee2022](https://github.com/tonylee2022/luci-app-openclaw)。
- 本项目在设计与实现上**参考、借鉴**了 [10000ge10000/luci-app-openclaw](https://github.com/10000ge10000/luci-app-openclaw)，在此致谢。
- OpenClaw、Node.js、ttyd、qrencode、微信渠道插件（`@tencent-weixin/openclaw-weixin`）等均为各自版权所有者的作品，遵循其各自许可证；本项目仅作集成与管理，不修改其授权策略。
- 按 GPL-3.0：你可以自由使用、修改、再分发本项目；衍生作品须同样以 GPL-3.0 开源、保留版权与许可声明，并且不附带任何担保。

## 📂 目录结构

```
luci-app-openclaw/
├── Makefile                          # OpenWrt 包定义
├── htdocs/luci-static/resources/
│   ├── openclaw/                     # 共享 RPC 客户端、UI 助手、样式、二维码库
│   └── view/openclaw/                # LuCI JavaScript 页面（基本设置/配置管理/控制台）
├── root/
│   ├── etc/
│   │   ├── config/openclaw           # UCI 配置
│   │   ├── init.d/openclaw           # procd 服务脚本
│   │   └── uci-defaults/99-openclaw  # 初始化脚本
│   └── usr/
│       ├── libexec/                  # Shell helper 与 RPC 执行层
│       ├── bin/openclaw              # OpenClaw CLI 包装器
│       ├── bin/openclaw-shell        # 隔离子 Shell
│       ├── bin/openclaw-env          # 环境安装/检查/升级工具
│       └── share/
│           ├── luci/menu.d/          # LuCI 菜单
│           ├── rpcd/                 # ucode API 与 ACL
│           └── openclaw/             # VERSION 等共享资源
├── scripts/                          # .ipk / .apk / .run 构建与发布脚本
└── .github/workflows/                # 在线构建并发布到 GitHub Release
```

## 贡献

欢迎在 [Issues](https://github.com/tonylee2022/luci-app-openclaw/issues) 反馈问题、提交 Pull Request。

## License

[GPL-3.0](LICENSE)
