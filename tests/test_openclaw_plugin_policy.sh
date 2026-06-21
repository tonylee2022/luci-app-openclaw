#!/bin/sh
set -eu

fail() { echo "FAIL: $1" >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
	echo "SKIP: node unavailable"
	exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

awk '
/OPENCLAW_SYNC_JS_START/ { capture=1; next }
/OPENCLAW_SYNC_JS_END/ { capture=0 }
capture { print }
' root/etc/init.d/openclaw > "$tmp/sync.js"

[ -s "$tmp/sync.js" ] || fail "unable to extract config sync JavaScript"

cat > "$tmp/openclaw.json" <<'EOF'
{
  "plugins": {
    "allow": ["minimax", "user-plugin"],
    "deny": ["blocked-plugin"],
    "entries": {
      "minimax": {"enabled": false},
      "user-plugin": {"enabled": true, "custom": "keep"}
    },
    "installs": {
      "user-plugin": {"installPath": "/custom/plugin", "source": "user"}
    }
  },
  "gateway": {"port": 1, "bind": "loopback"}
}
EOF

node -e 'const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify(d.plugins));' \
	"$tmp/openclaw.json" "$tmp/plugins.before"

# 令牌解耦后: sync 不再写明文令牌(改由 env/--token 注入), 但仍须设置 port/bind 且不动插件策略。
OC_SYNC_FILE="$tmp/openclaw.json" OC_SYNC_PORT=18789 OC_SYNC_BIND=lan \
	node "$tmp/sync.js"

node -e '
const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1]));
const before=fs.readFileSync(process.argv[2],"utf8");
if(JSON.stringify(d.plugins)!==before)process.exit(1);
if(d.gateway.port!==18789||d.gateway.bind!=="lan")process.exit(2);
if(d.gateway.auth&&typeof d.gateway.auth.token!=="undefined")process.exit(3);
' "$tmp/openclaw.json" "$tmp/plugins.before" || fail "config sync changed plugin policy or missed gateway fields"

# SecretRef 令牌必须被保留(不被 sync 删除/覆盖)，以兼容用户经 openclaw secrets 的迁移。
cat > "$tmp/ref.json" <<'EOF'
{"gateway":{"auth":{"token":"${OPENCLAW_GATEWAY_TOKEN}"}}}
EOF
OC_SYNC_FILE="$tmp/ref.json" OC_SYNC_PORT=18789 OC_SYNC_BIND=lan node "$tmp/sync.js"
node -e '
const fs=require("fs"),d=JSON.parse(fs.readFileSync(process.argv[1]));
if(d.gateway.auth.token!=="${OPENCLAW_GATEWAY_TOKEN}")process.exit(1);
' "$tmp/ref.json" || fail "config sync must preserve a SecretRef gateway token"

echo ok
