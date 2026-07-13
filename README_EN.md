# luci-app-openclaw

[简体中文](README.md) | [English](README_EN.md)

[![Build & Release](https://github.com/tonylee2022/luci-app-openclaw/actions/workflows/build.yml/badge.svg)](https://github.com/tonylee2022/luci-app-openclaw/actions/workflows/build.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

An OpenWrt / iStoreOS LuCI management app for the OpenClaw AI Gateway.

Run OpenClaw on your router and use LuCI to install its runtime, manage the service, configure models and channels, and perform upgrades. OpenClaw always runs as the non-root `openclaw` user.

<div align="center">
  <img src="docs/images/overview.png" alt="OpenClaw LuCI Basic Settings" width="900" style="border-radius:8px;" />
</div>

## 🖼 Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/images/wizard.png" alt="Official setup / openclaw-shell" width="100%" /><br/><sub><b>Configuration · Official setup</b>: run the official wizard in a real embedded terminal, or open an openclaw-shell session with one click.</sub></td>
    <td width="50%" valign="top"><img src="docs/images/providers.png" alt="Models and providers" width="100%" /><br/><sub><b>Configuration · Providers</b>: view configured providers, their authentication methods and model counts, and select the active model.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img src="docs/images/channels.png" alt="Messaging channels" width="100%" /><br/><sub><b>Configuration · Channels</b>: WeChat QR-code login, Telegram Bot Token setup, and pairing.</sub></td>
    <td width="50%" valign="top"><img src="docs/images/console.png" alt="Web console" width="100%" /><br/><sub><b>Web Console</b>: use the embedded official OpenClaw management interface to chat and administer the gateway.</sub></td>
  </tr>
</table>

## ✨ Features

### Basic Settings (Services → OpenClaw → Basic Settings)

- **Status overview**: running / starting / stopped badge, autostart toggle, gateway port, active model, messaging channels, PID, memory usage, Node.js / OpenClaw / app versions, install path, and free space.
- **Quick actions**: install the runtime, start / restart / restart gateway only / stop, toggle autostart, upgrade the LuCI app, upgrade runtime components, and uninstall the runtime. Actions report progress in the information bar, while long-running tasks provide a live log panel.
- **Runtime installation**: automatically lists available mount points and free space. Select an install location and the stable or latest release; capacity and write access are checked before installation.
- **Runtime upgrades**: upgrade OpenClaw to the latest release, update the bundled npm, or switch Node.js to a specified version. The gateway restarts automatically when required.
- **Quick guide** and project links.

### Configuration (Services → OpenClaw → Configuration)

- **Official setup**: run the official `openclaw configure` wizard as the `openclaw` user in an embedded ttyd terminal, or open an **openclaw-shell** command line. The panel also includes a Restart gateway action with live progress.
- **Providers**: view configured providers, authentication methods, and model counts; select the default active model from configured models.
- **Channels**: only configured channels are listed.
  - **WeChat**: install the plugin, sign in with a clear QR code, check for updates, uninstall, and manage signed-in accounts.
  - **Telegram**: configure a Bot Token directly and pair private-message senders by approving a pairing code or reviewing pending requests.
- **Health check**: run `openclaw doctor` in lint or one-click repair mode; inspect and repair file ownership left behind by root-run plugin updates; scan for plaintext secrets with `openclaw secrets audit` and migrate them to SecretRef through `openclaw secrets configure`.
- **Logs**: view 50, 100, or 200 gateway log lines, clear the display, and enable two-second automatic refresh.

### Other

- **Web Console**: embeds the official OpenClaw console.
- **Theme support**: built-in light and dark styles follow the active LuCI theme, including themes such as Argon.
- **Chinese and English UI**: pages, menus, and operation feedback follow the selected LuCI language through standard LuCI i18n. The Simplified Chinese catalog lives in `po/zh_Hans/` and is installed as `usr/lib/lua/luci/i18n/openclaw.zh-cn.lmo`. Embedded ttyd terminal output does not follow the LuCI language setting.
- **Security model**: OpenClaw runs as the `openclaw` system user. When invoked by root, `openclaw` and `openclaw-shell` automatically drop privileges to the correct user.

## System Requirements

| Item | Requirement |
|------|-------------|
| Firmware | OpenWrt **23.05+** or a derivative such as LEDE, ImmortalWrt, or iStoreOS; use `.ipk` on 23.05-24.10 and `.apk` on 25.12+ |
| Architecture | x86_64 or aarch64 (ARM64) |
| C library | musl, detected automatically |
| Dependencies | luci-base, rpcd-mod-ucode, curl, openssl-util, ttyd, qrencode, libstdcpp |
| Storage | At least **2 GB** of free space |
| Memory | 1 GB or more recommended |

## Supported Versions

| Component | Default | Notes |
|-----------|---------|-------|
| OpenClaw | `2026.6.9` | Default tested release; the latest release can also be selected |
| Node.js | `22.22.3` | Minimum supported version: `22.19.0` |
| WeChat plugin | Official compatible release | `@tencent-weixin/openclaw-weixin@latest` |

## 📦 Installation

### Option 1: Self-extracting `.run` package (recommended)

No SDK is required. Use this on an already installed system.

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw_${VER}.run"
sh "luci-app-openclaw_${VER}.run"
```

### Option 2: OpenWrt 23.05-24.10 / `.ipk` package

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw_${VER}-1_all.ipk"
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-i18n-openclaw-zh-cn_${VER}-1_all.ipk"
opkg install "luci-app-openclaw_${VER}-1_all.ipk" "luci-i18n-openclaw-zh-cn_${VER}-1_all.ipk"
```

### Option 3: OpenWrt 25.12+ / `.apk` package

```bash
VER=$(curl -sI "https://github.com/tonylee2022/luci-app-openclaw/releases/latest" 2>/dev/null | grep -i "location:" | sed 's/.*tag\/v\{0,1\}//' | tr -d '\r\n')
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-app-openclaw-${VER}-r1.apk"
wget "https://github.com/tonylee2022/luci-app-openclaw/releases/download/v${VER}/luci-i18n-openclaw-zh-cn-${VER}-r1.apk"
apk add --allow-untrusted "luci-app-openclaw-${VER}-r1.apk" "luci-i18n-openclaw-zh-cn-${VER}-r1.apk"
```

### Option 4: Build into firmware

```bash
cd /path/to/openwrt
echo "src-git openclaw https://github.com/tonylee2022/luci-app-openclaw.git" >> feeds.conf.default
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig   # LuCI → Applications → luci-app-openclaw
make package/luci-app-openclaw/compile V=s
```

## 🔰 First Use

1. Open LuCI → **Services → OpenClaw → Basic Settings**, click **Install runtime**, and select a mount point with at least 2 GB of free space and the desired version. Refresh the page when installation finishes, then click **Start**.
2. Go to **Configuration → Official setup** and add a provider and API key through the official wizard or `openclaw-shell`.
3. Go to **Configuration → Channels** to configure WeChat (install plugin → scan QR code) or Telegram (enter Bot Token → pair).
4. After changing configuration, click **Restart** or **Restart gateway**. A **Running** status badge confirms that the gateway is healthy.

## Command-Line Usage

After connecting to the router over SSH, the following commands run as the `openclaw` user:

```bash
openclaw-shell                  # Enter an isolated openclaw user shell; use exit to leave
openclaw-env check              # Check the runtime environment
openclaw-env upgrade            # Upgrade OpenClaw to the latest release
openclaw-env node [x.y.z]       # Install/update Node.js; omit the version to use the default
```

For a custom install path, set `OPENCLAW_INSTALL_PATH` for an individual command:

```bash
OPENCLAW_INSTALL_PATH=/mnt/data openclaw-shell
```

## Custom Install Path

The UCI option is `openclaw.main.install_path`. The runtime directory is always expanded to `<base path>/openclaw`:

```bash
uci set openclaw.main.install_path='/mnt/data'
uci commit openclaw
openclaw-env setup
```

Installed directory layout:

```text
/mnt/data/openclaw/
├── node/          # Node.js runtime
├── .npm-global/   # Global npm packages, including OpenClaw and pnpm
├── .npm/          # npm cache
├── .openclaw/     # OpenClaw configuration, state, sessions, and plugins
└── .tmp/          # Temporary npm and plugin files
```

Installation stops with a clear error if the disk is full or read-only, an external volume is not mounted, or the target directory contains unknown files.

## 🤖 AI Workspace Integration

After installation, the app writes local deployment details to a managed block in the OpenClaw workspace `AGENTS.md`, including runtime paths and permission boundaries. This tells AI agents which operations, such as restarting the service, must be performed through LuCI or by root instead of repeatedly attempting actions outside their permissions.

The managed block conveys the following instructions (`$OC_HOME` and related variables are expanded to their actual paths at runtime):

```text
<!-- luci-app-openclaw:openwrt-runtime:start -->
## 7. Deployment constraints (managed by luci-app-openclaw; do not edit this block)

This instance is deployed by luci-app-openclaw. The Gateway process is managed
by OpenWrt procd as root. The `openclaw` user cannot execute init scripts or
control the service lifecycle.

To restart the service or Gateway, ask the user to use LuCI or run the
corresponding init command over SSH as root.

Runtime paths (read-only reference; do not modify):

- OpenClaw HOME: `/opt/openclaw`
- OpenClaw state: `/opt/openclaw/.openclaw`
- npm prefix: `/opt/openclaw/.npm-global`
- npm cache: `/opt/openclaw/.npm`
- temporary files: `/opt/openclaw/.tmp`
<!-- luci-app-openclaw:openwrt-runtime:end -->
```

The example uses the default `/opt` base path; actual values follow the selected install path. User-authored content in `AGENTS.md` remains untouched, and upgrades only update the app's managed block.

## 🔒 Security Model

- **Non-root runtime**: OpenClaw always runs as the `openclaw` system user. `/usr/bin/openclaw` and `openclaw-shell` drop privileges when invoked by root. The ttyd setup terminal also runs as `openclaw` and binds to `br-lan`, making it reachable only from the LAN.
- **Gateway token separation**: the gateway token is stored in UCI at `/etc/config/openclaw`, outside the OpenClaw state directory and its private Git history. It is injected into the gateway and CLI through `OPENCLAW_GATEWAY_TOKEN` and `gateway run --token`. No plaintext token is written to `openclaw.json`, so migrating or removing `gateway.auth.token` with `openclaw secrets configure/apply` does not break LuCI console access.
- **SecretRef compatibility**: channel status gracefully handles secrets migrated to SecretRef instead of failing when it encounters a reference. The health page includes a plaintext-secret scan to guide migration.
- **Setup terminal**: the former root-run, network-listening Web PTY has been retired because it exposed a local `openclaw`-to-root privilege-escalation path. Setup now uses a ttyd wizard running as `openclaw` and bound to `br-lan`.
- **Web Console trust assumption**: the embedded OpenClaw console is accessed over HTTP on the LAN and relaxes gateway device-authentication and origin checks. It therefore **trusts users on the LAN**. Never expose the gateway port, `18789` by default, to the WAN. See [SECURITY.md](SECURITY.md).
- **No plugin-policy interference**: plugin allowlists, denylists, enablement, and other policy remain under OpenClaw's official mechanisms and the user's control. The only exception is user-driven installation, enablement, and removal of the WeChat channel.

## 📜 Copyright and Open Source

This project is licensed under [GPL-3.0](LICENSE).

- © 2026 [tonylee2022](https://github.com/tonylee2022/luci-app-openclaw).
- The design and implementation were informed by [10000ge10000/luci-app-openclaw](https://github.com/10000ge10000/luci-app-openclaw), with thanks to its authors.
- OpenClaw, Node.js, ttyd, qrencode, and the WeChat channel plugin (`@tencent-weixin/openclaw-weixin`) remain the works of their respective copyright holders and are governed by their own licenses. This project only integrates and manages them; it does not alter their authorization policies.
- Under GPL-3.0, you may use, modify, and redistribute this project. Derivative works must remain GPL-3.0 licensed, preserve copyright and license notices, and are provided without warranty.

## 📂 Project Structure

```text
luci-app-openclaw/
├── Makefile                          # OpenWrt package definition
├── htdocs/luci-static/resources/
│   ├── openclaw/                     # Shared RPC client, UI helpers, styles, and QR library
│   └── view/openclaw/                # LuCI JavaScript views
├── root/
│   ├── etc/
│   │   ├── config/openclaw           # UCI configuration
│   │   ├── init.d/openclaw           # procd service script
│   │   └── uci-defaults/99-openclaw  # Initialization script
│   └── usr/
│       ├── libexec/                  # Shell helpers and RPC execution layer
│       ├── bin/openclaw              # OpenClaw CLI wrapper
│       ├── bin/openclaw-shell        # Isolated user shell
│       ├── bin/openclaw-env          # Runtime install/check/upgrade tool
│       └── share/
│           ├── luci/menu.d/          # LuCI menu
│           ├── rpcd/                 # ucode API and ACL
│           └── openclaw/             # Generated VERSION and shared resources
├── scripts/                          # .ipk/.apk/.run build and release scripts
└── .github/workflows/                # CI builds and GitHub Releases
```

## Contributing

Bug reports and pull requests are welcome through [Issues](https://github.com/tonylee2022/luci-app-openclaw/issues).

## License

[GPL-3.0](LICENSE)
