# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in luci-app-openclaw, please report it
responsibly by sending an email to **tonydll1970@gmail.com** with the subject
line `[SECURITY] luci-app-openclaw`.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any suggested fixes (optional)

**Do not open a public GitHub issue for security vulnerabilities.**

We will acknowledge receipt within 72 hours and aim to release a patch within
14 days for critical issues.

## Supported Versions

Only the latest released version receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Security Model & Trust Assumptions

This plugin manages OpenClaw on a router and **trusts the LAN**. The threat
model assumes the router's LAN is administered by the user; it does **not**
defend against a hostile device already on the LAN. Do not expose the gateway
port (default `18789`) or LuCI to the WAN.

### Privilege separation

- OpenClaw runs as the non-root `openclaw` system user. The procd-managed
  gateway, the CLI wrapper (`/usr/bin/openclaw`), `openclaw-shell`, and the
  ttyd configuration wizard all run (or auto-drop) as `openclaw`. The wizard
  binds to `br-lan` only.
- The legacy root Web PTY (`web-pty`, formerly listening on `0.0.0.0:18793`)
  has been **retired**. It allowed a process running as `openclaw` to read the
  world-readable PTY token from UCI and obtain a root shell — a local privilege
  escalation. Configuration now goes exclusively through the `openclaw`-scoped
  ttyd wizard.

### Gateway token handling

- The gateway auth token lives in UCI (`/etc/config/openclaw`), which is
  **outside** OpenClaw's state directory and backup scope. It is injected into
  the gateway and CLI at runtime via the `OPENCLAW_GATEWAY_TOKEN` environment
  variable (and `gateway run --token`). Plaintext is **not** written into
  `openclaw.json`.
- Environment/`--token` input takes precedence over any value in
  `openclaw.json`, so migrating `gateway.auth.token` to a SecretRef (or
  scrubbing it) via `openclaw secrets configure/apply` does not break the LuCI
  console. Use the **Health → secrets audit** scan to find remaining plaintext
  credentials and migrate them with `openclaw secrets configure`.

### Embedded Control UI

The LuCI **Web 控制台** embeds the OpenClaw Control UI over LAN HTTP. To make a
zero-config embedded console work in a plain-HTTP browser context, the gateway's
default device-auth and origin checks are intentionally relaxed. These are
LAN-scoped trade-offs and assume a trusted LAN — do not expose the gateway to
the WAN.
