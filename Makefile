# luci-app-openclaw — OpenWrt package Makefile
# 兼容两种集成方式:
#   1. 作为 feeds 源: echo "src-git openclaw ..." >> feeds.conf.default
#   2. 直接放入 package/ 目录: git clone ... package/luci-app-openclaw

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-openclaw
# 版本号唯一来源 (LuCI 惯例: 写在 Makefile)。构建时由此生成 /usr/share/openclaw/VERSION 供运行时读取。
PKG_VERSION:=1.2.1
PKG_RELEASE:=1

PKG_MAINTAINER:=tonylee2022 <tonylee2022@users.noreply.github.com>
PKG_LICENSE:=GPL-3.0

LUCI_TITLE:=OpenClaw AI 网关 LuCI 管理插件
LUCI_DEPENDS:=+luci-base +rpcd-mod-ucode +curl +openssl-util +ttyd +qrencode +libstdcpp +shadow-su
LUCI_PKGARCH:=all

# 优先使用 luci.mk (feeds 模式), 不可用时回退 package.mk
ifeq ($(wildcard $(TOPDIR)/feeds/luci/luci.mk),)

  include $(INCLUDE_DIR)/package.mk

  define Package/$(PKG_NAME)
    SECTION:=luci
    CATEGORY:=LuCI
    SUBMENU:=3. Applications
    TITLE:=$(LUCI_TITLE)
    DEPENDS:=$(LUCI_DEPENDS)
    PKGARCH:=all
  endef

  define Package/$(PKG_NAME)/description
    OpenClaw AI Gateway 的 LuCI 管理插件。
    支持 12+ AI 模型提供商和 Telegram/Discord 等多种消息渠道。
  endef

else

  include $(TOPDIR)/feeds/luci/luci.mk

endif

define Package/$(PKG_NAME)/conffiles
/etc/config/openclaw
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/openclaw $(1)/etc/config/openclaw
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/99-openclaw $(1)/etc/uci-defaults/99-openclaw
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/openclaw $(1)/etc/init.d/openclaw
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./root/usr/bin/openclaw-env $(1)/usr/bin/openclaw-env
	$(INSTALL_BIN) ./root/usr/bin/openclaw $(1)/usr/bin/openclaw
	$(INSTALL_BIN) ./root/usr/bin/openclaw-shell $(1)/usr/bin/openclaw-shell
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./root/usr/libexec/openclaw-paths.sh $(1)/usr/libexec/openclaw-paths.sh
	$(INSTALL_BIN) ./root/usr/libexec/openclaw-node.sh $(1)/usr/libexec/openclaw-node.sh
	$(INSTALL_BIN) ./root/usr/libexec/openclaw-workspace.sh $(1)/usr/libexec/openclaw-workspace.sh
	$(INSTALL_BIN) ./root/usr/libexec/openclaw-rpc.sh $(1)/usr/libexec/openclaw-rpc.sh
	$(INSTALL_BIN) ./root/usr/libexec/openclaw-wizard.sh $(1)/usr/libexec/openclaw-wizard.sh
	$(INSTALL_DIR) $(1)/www/luci-static/resources/openclaw
	$(INSTALL_DATA) ./htdocs/luci-static/resources/openclaw/* $(1)/www/luci-static/resources/openclaw/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/openclaw
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/openclaw/*.js $(1)/www/luci-static/resources/view/openclaw/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-openclaw.json $(1)/usr/share/luci/menu.d/luci-app-openclaw.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-openclaw.json $(1)/usr/share/rpcd/acl.d/luci-app-openclaw.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_BIN) ./root/usr/share/rpcd/ucode/luci.openclaw $(1)/usr/share/rpcd/ucode/luci.openclaw
	$(INSTALL_DIR) $(1)/usr/share/openclaw
	echo "$(PKG_VERSION)" > $(1)/usr/share/openclaw/VERSION
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	( . /etc/uci-defaults/99-openclaw ) && rm -f /etc/uci-defaults/99-openclaw
	rm -f /usr/lib/lua/luci/controller/openclaw.lua
	rm -rf /usr/lib/lua/luci/model/cbi/openclaw /usr/lib/lua/luci/view/openclaw /usr/lib/lua/openclaw
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* /tmp/luci-openclaw-status.* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	exit 0
}
endef

define Package/$(PKG_NAME)/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-openclaw-* /tmp/luci-openclaw-update-cache.* 2>/dev/null
	rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
	# 完全卸载时(非升级)清理 conffile 本体、opkg 冲突副本、备份残留, 以及 /tmp 任务/缓存/日志残留。
	# opkg 升级时设 PKG_UPGRADE=1, 真卸载时为 0/未设; 仅真卸载才清理。
	[ "$${PKG_UPGRADE}" = "1" ] || { rm -f /etc/config/openclaw /etc/config/openclaw-opkg /etc/config/openclaw*.bak 2>/dev/null; rm -rf /tmp/openclaw 2>/dev/null; rm -f /tmp/openclaw-* /tmp/luci-openclaw-* 2>/dev/null; }
}
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
