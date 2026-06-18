#!/bin/sh
set -eu

fail() { echo "FAIL: $1" >&2; exit 1; }

if command -v node >/dev/null 2>&1; then
	node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' root/usr/share/luci/menu.d/luci-app-openclaw.json
	node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' root/usr/share/rpcd/acl.d/luci-app-openclaw.json
	for file in htdocs/luci-static/resources/openclaw/api.js htdocs/luci-static/resources/view/openclaw/*.js; do
		node --check "$file" >/dev/null || fail "JavaScript syntax: $file"
	done
else
	echo "SKIP: node unavailable"
fi

grep -q '"type": "view"' root/usr/share/luci/menu.d/luci-app-openclaw.json || fail "menu must route to JS views"
grep -q '"luci.openclaw"' root/usr/share/rpcd/acl.d/luci-app-openclaw.json || fail "ACL must grant the rpcd object"
grep -q '"read"' root/usr/share/rpcd/acl.d/luci-app-openclaw.json || fail "read ACL missing"
grep -q '"write"' root/usr/share/rpcd/acl.d/luci-app-openclaw.json || fail "write ACL missing"
grep -q "'require baseclass';" htdocs/luci-static/resources/openclaw/api.js || fail "shared LuCI module must require baseclass"
grep -q 'return baseclass.extend({' htdocs/luci-static/resources/openclaw/api.js || fail "shared LuCI module must export a LuCI class"
grep -q "uninstallLog: call('uninstall_log')" htdocs/luci-static/resources/openclaw/api.js || fail "uninstall task log RPC missing"
grep -q 'oc-capacity-grid' htdocs/luci-static/resources/view/openclaw/overview.js || fail "install capacity details missing"
grep -q 'api.upgradeLog()' htdocs/luci-static/resources/view/openclaw/overview.js || fail "upgrade task must use the persistent task panel"
grep -q "'type': 'button'" htdocs/luci-static/resources/view/openclaw/overview.js || fail "overview buttons must not submit forms"
grep -q "'type': 'button'" htdocs/luci-static/resources/view/openclaw/advanced.js || fail "channel/config buttons must not submit forms"
grep -q 'closeButton:' htdocs/luci-static/resources/openclaw/ui.js || fail "synchronous modal close helper must be defined in shared ui.js"
grep -q 'ev.preventDefault()' htdocs/luci-static/resources/openclaw/ui.js || fail "modal close must prevent default submission"
grep -q 'ocui.closeButton' htdocs/luci-static/resources/view/openclaw/overview.js || fail "overview must use shared closeButton from ocui"
grep -q 'api.setupLog().then' htdocs/luci-static/resources/view/openclaw/overview.js || fail "setup submission recovery check missing"
grep -q 'showAcceptedTask' htdocs/luci-static/resources/view/openclaw/overview.js || fail "accepted setup must use the persistent task panel"
if grep -q "button(_('关闭')" htdocs/luci-static/resources/view/openclaw/overview.js; then
	fail "modal close buttons must not use the asynchronous action wrapper"
fi
if grep -q 'showTask:' htdocs/luci-static/resources/view/openclaw/overview.js; then
	fail "long-running task logs must not use a modal"
fi

echo ok
