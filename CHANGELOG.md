# 更新记录

## [1.2.6]

- **修复 opkg 安装 `.ipk` 报 malformed**：本地/工作流生成的 `.ipk` 改为当前 OpenWrt/LEDE `opkg` 可识别的 gzip tar 容器，保留 `debian-binary`、`control.tar.gz`、`data.tar.gz` 三段结构，解决插件升级时报 `pkg_init_from_file: Malformed package file` 的问题。
- **修复升级检测误报降级**：插件升级检测改为语义化版本比较，只有 GitHub latest 版本高于当前安装版本才提示升级；本地预装未发布的新版本时不再显示“发现旧版本可升级”。
- **维护工作流历史**：Release 工作流会在结束后清理旧运行记录，仅保留最近 4 个 completed runs，避免 Actions artifact 与历史运行长期堆积。

## [1.2.4]

- **固定插件升级包格式选择**：所有构建产物写入 `/usr/share/openclaw/PACKAGE_FORMAT`，`.ipk` 标记为 `ipk`、`.apk` 标记为 `apk`、`.run` 标记为 `run`；网页插件升级优先按该标记选择 Release 资产和包管理器，旧安装或 `.run` 安装再回退运行时检测。
- **增强打包契约测试**：新增对 `PACKAGE_FORMAT` 的构建脚本、Makefile 与升级逻辑检查，防止后续版本再次把 apk 系统误导到 ipk/opkg 路径。

## [1.2.3]

- **规范化拆分发布包**：`.ipk` 与 `.apk` 均拆为主包 `luci-app-openclaw` 和中文语言包 `luci-i18n-openclaw-zh-cn`，主包不再携带 `openclaw.zh-cn.lmo`，避免与 OpenWrt/LuCI 标准 i18n 包发生文件所有权冲突。
- **修复网页插件升级包格式差异**：插件升级会按系统包管理器选择 `opkg/ipk` 或 `apk/apk` 资产；主包升级必须成功，语言包尽力更新，避免已安装 OpenWrt 官方风格语言包时拖垮主插件升级。
- **更新工作流与安装文档**：GitHub Actions 同时发布 `.run`、主 `.ipk`、i18n `.ipk`、主 `.apk`、i18n `.apk`，README 与 Release 说明同步改为两包安装命令。

## [1.2.1]

- **修复插件升级覆盖 UCI 设置**：兼容 `opkg --force-reinstall` 与终端直接执行 `opkg install` 的路径，升级前暂存并在安装后恢复 `enabled`、端口、绑定方式、token 与安装路径，避免升级后开机自启变为关闭或运行环境路径回到默认值。
- **彻底清理退役的备份/恢复功能残留**：从 README 功能列表、中文翻译目录、共享路径助手与通用 UI 注释中移除旧说明和死代码。包升级时用于保留 UCI 设置的一次性内部配置快照不属于用户备份功能，安装完成后会立即删除。
- **新增英文项目说明**：增加 `README_EN.md`，完整覆盖功能、安装、首次配置、命令行、自定义路径、AI 工作区集成与安全模型；中英文 README 顶部可互相切换，并加入文档完整性测试。

## [1.2.0]

- **移除备份/恢复功能**：实测发现配置备份只含 `openclaw.json`、不含认证凭证（凭证另存于 `.openclaw/credentials`、网关 token 在 UCI），恢复后仍需重输全部密钥；完整备份则因含大量（绝对路径）软链接被恢复/导入的安全校验拒绝，本质不可恢复。该功能价值有限且易误导，故整体移除：删除基本配置里的「备份/恢复」入口与全部相关后端 action、ucode 方法、ACL、前端代码、`openclaw-backup.sh` 助手及其测试。
- **版本号管理收敛**：删除冗余的 `VERSION` 文件，插件版本号回归 LuCI 惯例只在 `Makefile` 的 `PKG_VERSION` 声明（构建时生成 `/usr/share/openclaw/VERSION` 供运行时读取）；删除 `VERSION.json`，运行时依赖版本（Node/OpenClaw）以 `openclaw-env` 为唯一来源，契约测试改为直接守护 `init.d` 与 `openclaw-env` 的一致性。
- **发版与构建解耦**：CI 仅在推送 `v*` 标签（或手动 dispatch）时创建 Release；推送 `main` 只跑构建与校验、不再「改版本号即自动发版」，避免日常提交误触发发布。
- **界面优化**：Web 控制台「在新窗口打开」改为标题行右侧的蓝色按钮；消息渠道/微信/Telegram 的状态徽章配色统一（修复深色模式 `.oc-field` 着色规则泄漏到嵌套徽章的问题）；「会话隔离」说明文字提亮；Telegram「已配对」改为绿色标签 + 原色用户 ID；基本配置「检测升级」更名为「插件升级」。
- **样式缓存根治**：新增 `ocui.cssLink()`，给 `openclaw.css` 链接附带版本号 query，改动样式后递增 `CSS_VERSION` 即可让所有视图加载最新样式，免受浏览器/主题对静态资源的顽固缓存影响。

## [1.1.9]

- **新增中英双语界面（i18n）**：恢复标准 LuCI 多语言机制。前端文案、菜单标题、操作反馈与后端返回 UI 的消息统一以英文作为翻译键，新增简体中文语言包 `po/zh_Hans/openclaw.po`，随包编译为 `usr/lib/lua/luci/i18n/openclaw.zh-cn.lmo`。LuCI 界面语言设为 English 显示英文、设为简体中文显示中文，自动跟随切换。新增纯 Python 的 `scripts/po2lmo.py`（字节级对齐 LuCI 官方 `po2lmo`，无需 OpenWrt SDK 即可在本地/CI 把 po 编译为 lmo），并接入 `build_ipk.sh` / `build_run.sh`；新增 `tests/test_openclaw_i18n.sh` 做漏译与编译校验。注：网页内嵌终端（配置向导 / openclaw-shell）由 ttyd 运行、不经 LuCI 渲染层，其输出仍为中文。

## [1.1.8]

- **彻底改用 `.tar.gz`、不再依赖 `xz`**：1.1.7 用「gz 优先 + xz 回退 + xz 依赖兜底」。现进一步**只下载 `.tar.gz`**（gzip 为 busybox tar 内置，零外部命令），移除 `.tar.xz` 回退与 `xz`/`xzcat` 解压代码，并从 Makefile/build_ipk/build_run 的依赖中**移除 `xz`**。离线安装也只接受 `node.tar.gz`。无 `xz` 机器实测：下载 `.tar.gz`、解压安装成功。

## [1.1.7]

- **修复其他机器「安装运行环境」解压 Node.js 包报错退出码 127**：在线安装下载 `node-…-musl.tar.xz`，而解 `.tar.xz` 依赖独立的 `xz` 命令（OpenWrt 上 `tar` 与 `xz` 是两个包，`tar` 解 xz 时会去 exec `xz`）；目标机未装 `xz` 时 tar 子进程 exec 失败 → **退出 127**。lede 恰好装了 `xz` 才正常。修复：`download_node` **优先下载 `.tar.gz`**（gzip 为 busybox 内置、无需外部命令，任意机器可解），`.tar.xz` 仅作回退；同时把 `xz` 加入依赖（兜底 .xz/离线场景），离线安装分支也优先接受 `node.tar.gz`。无 `xz` 机器实测：抓 `.tar.gz`、解压成功、无 127。

## [1.1.6]

- **修复「设置活跃模型」卡死并拖垮 LuCI**：原先同步跑 `openclaw models set`（连慢网关 + 触发热重载重启 provider，网络异常时可达数十秒），经 ucode popen 阻塞 rpcd 的 uloop，导致整个 LuCI 无响应/打不开。改为**直接写 `agents.defaults.model.primary`**（实测 0.04s），网关 file-watcher 自动热重载该键；不再调用慢的 `config patch`（实测 6s）或 `models set`，也不再额外重启网关。附带消除"所选模型被塞进回退列表"问题（只改 primary）。
- **`oc_cli_run` 加 `timeout` 安全网**：所有同步网关 CLI（channels/doctor/health/logs 等）经 ucode popen 跑在 rpcd 上，网关挂死时至多阻塞 30s 后返回，杜绝永久锁死 rpcd。
- **插件安装零 `/opt` 足迹**：`uci-defaults` 不再在装插件时创建 `openclaw` 系统用户与 `/opt/openclaw` 目录骨架——这些改由「安装运行环境」(`openclaw-env setup`) 按所选安装路径创建。避免未装运行时就落地默认 `/opt` 残留、以及选自定义路径后的孤儿目录。
- **修复自定义安装路径仍残留 `/opt/openclaw`**：①`_oc_fix_opt` 的 /opt 可写性探针改用 `/opt/.oc-write-test.$$`（用完即删），不再用 `/opt/openclaw/.probe`（会残留空 `/opt/openclaw`）；②`ensure_openclaw_user` 在用户已存在时**纠正陈旧 home**（旧 `/opt` 安装遗留、`opkg remove` 不删用户），使其与当前安装路径一致。
- **修复自定义安装路径下 `openclaw` CLI 全线失效（回退 `/opt`）**：`/usr/bin/openclaw` 以 root 调用时先 `su` 降权到 openclaw，降权后 PATH 变为 `/bin:/usr/bin`（不含 `/sbin`），`uci`（在 `/sbin`）找不到 → `install_path` 解析回退到 `/opt` → 找不到 `/opt/node` 报 "OpenClaw Node.js not found"。装在 `/root` 等非默认路径时所有 `openclaw …` 命令（含 `agents auth`、Claude CLI 登录）均报错。现解析前补 `/sbin /usr/sbin` 进 PATH；`openclaw-shell` 同步加固。
- **修复装插件/技能后留 root 属主文件、可致网关重启失败**：init.d 的 `fix_managed_plugin_ownership` 旧版每次启动把受管插件目录强制 `chown root:root`（图代码不可被 AI 篡改的免疫），导致官方向导/内部 AI/CLI 装的插件全留 root 残留 → `perm_check` 误报大量「权属问题」、与 `perm_fix` 反复拉扯。实测 OpenClaw 同时接受「插件属主 = 运行身份(openclaw) 或 root」(docs/tools/plugin.md)，故改为每次启动归一到 **openclaw**：无论谁装的插件/技能都被规整为运行身份，杜绝 root 残留与误报。
- **新增「回退模型」直接管理**：提供商页新增入口，多选保留/一键清空 `agents.defaults.model.fallbacks` 并直接写配置（与活跃模型同款快路径，0.05s，网关热重载、不连网关、不阻塞 rpcd）。绕开官方 `configure` 向导——其模型多选会把已勾选的非 primary 模型全堆进 fallback，本入口提供稳定的兜底清理/精选；概览同时显示当前回退模型列表。
- **重启网关后自动刷新配置页**：在配置页内重启网关（官方向导完成 / openclaw-shell）后，已加载的「提供商」「渠道」数据自动重新拉取，不必手动点各卡片「刷新」。

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
