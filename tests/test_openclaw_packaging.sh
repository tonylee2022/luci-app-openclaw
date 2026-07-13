#!/bin/sh
set -eu

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

[ -f scripts/build_ipk.sh ] || fail "build_ipk.sh missing"
[ -f scripts/build_apk.sh ] || fail "build_apk.sh missing"

grep -q 'tar czf "$IPK_FILE" debian-binary control.tar.gz data.tar.gz' scripts/build_ipk.sh || \
	fail "ipk package must be a gzip tar container for this opkg"
grep -q 'IPK_FILE="$OUT_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"' scripts/build_ipk.sh || \
	fail "ipk filename must keep OpenWrt opkg naming"
grep -q 'I18N_PKG_NAME="luci-i18n-openclaw-zh-cn"' scripts/build_ipk.sh || \
	fail "ipk builder must define the LuCI i18n split package"
grep -q 'I18N_IPK_FILE="$OUT_DIR/${I18N_PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"' scripts/build_ipk.sh || \
	fail "ipk builder must emit a split LuCI i18n package"
grep -q 'PACKAGE_FORMAT' scripts/build_ipk.sh || \
	fail "ipk builder must stamp package format"
grep -q 'printf .*"ipk".*>.*PACKAGE_FORMAT' scripts/build_ipk.sh || \
	fail "ipk builder must stamp PACKAGE_FORMAT=ipk"
grep -q '\${BUILD_RUN:-1}' scripts/build_ipk.sh || \
	fail "ipk package builder must allow workflow to skip duplicate run build"

grep -q 'PKG_VERSION_RELEASE="${PKG_VERSION}-r${PKG_RELEASE}"' scripts/build_apk.sh || \
	fail "apk version must use apk-tools VERSION-rRELEASE format"
grep -q 'PKG_ARCH="noarch"' scripts/build_apk.sh || \
	fail "apk arch must be noarch for all/LuCI packages"
grep -q 'APK_FILE="$OUT_DIR/${PKG_NAME}-${PKG_VERSION_RELEASE}.apk"' scripts/build_apk.sh || \
	fail "apk filename must keep OpenWrt apk naming"
grep -q 'I18N_PKG_NAME="luci-i18n-openclaw-zh-cn"' scripts/build_apk.sh || \
	fail "apk builder must define the LuCI i18n split package"
grep -q 'I18N_APK_FILE="$OUT_DIR/${I18N_PKG_NAME}-${PKG_VERSION_RELEASE}.apk"' scripts/build_apk.sh || \
	fail "apk builder must emit a split LuCI i18n package"
grep -q 'PACKAGE_FORMAT' scripts/build_apk.sh || \
	fail "apk builder must stamp package format"
grep -q 'printf .*"apk".*>.*PACKAGE_FORMAT' scripts/build_apk.sh || \
	fail "apk builder must stamp PACKAGE_FORMAT=apk"
grep -q '\${PKG_NAME}.conffiles_static' scripts/build_apk.sh || \
	fail "apk package must include conffiles_static metadata"
grep -q '\${PKG_NAME}.list' scripts/build_apk.sh || \
	fail "apk package must include installed file list metadata"
grep -q 'openclaw.zh-cn.lmo' scripts/build_ipk.sh || \
	fail "ipk split i18n package must ship LuCI lmo"
grep -q 'openclaw.zh-cn.lmo' scripts/build_apk.sh || \
	fail "apk split i18n package must ship LuCI lmo"

grep -q 'BUILD_RUN=0 sh scripts/build_ipk.sh dist' .github/workflows/build.yml || \
	fail "workflow must build run and ipk as separate artifacts"
grep -q 'Build .apk package' .github/workflows/build.yml || \
	fail "workflow must build apk package"
grep -q 'sh scripts/build_apk.sh dist' .github/workflows/build.yml || \
	fail "workflow must call apk package helper"
grep -q 'dist/\*.run dist/\*.ipk dist/\*.apk' .github/workflows/build.yml || \
	fail "workflow checksums must include run, ipk, and apk outputs"
grep -q 'actions: write' .github/workflows/build.yml || \
	fail "workflow must allow deleting old workflow runs"
grep -q 'Cleanup old workflow runs' .github/workflows/build.yml || \
	fail "workflow must clean up old workflow runs"
grep -q 'KEEP_WORKFLOW_RUNS: 4' .github/workflows/build.yml || \
	fail "workflow cleanup must keep a bounded recent run history"
grep -q 'gh run delete' .github/workflows/build.yml || \
	fail "workflow cleanup must delete old runs through gh"
grep -q 'OpenWrt 23.05-24.10 / opkg .ipk' .github/workflows/build.yml || \
	fail "release body must label ipk compatibility"
grep -q 'OpenWrt 25.12+ / apk .apk' .github/workflows/build.yml || \
	fail "release body must label apk compatibility"
grep -q 'luci-app-openclaw-${{ steps.version.outputs.version }}-r1.apk' .github/workflows/build.yml || \
	fail "release body must use apk-tools -r release suffix"
grep -q 'luci-i18n-openclaw-zh-cn_${{ steps.version.outputs.version }}-1_all.ipk' .github/workflows/build.yml || \
	fail "release body must include split ipk i18n package"
grep -q 'luci-i18n-openclaw-zh-cn-${{ steps.version.outputs.version }}-r1.apk' .github/workflows/build.yml || \
	fail "release body must include split apk i18n package"

grep -q 'PACKAGE_FORMAT' scripts/build_run.sh || \
	fail "run installer must stamp package format"
grep -q 'printf .*"run".*>.*PACKAGE_FORMAT' scripts/build_run.sh || \
	fail "run installer must stamp PACKAGE_FORMAT=run"
grep -q 'CONFIG_USE_APK' Makefile || \
	fail "Makefile package install must stamp package format from OpenWrt build config"

echo ok
