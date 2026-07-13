#!/bin/sh
set -eu

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

[ -f scripts/build_ipk.sh ] || fail "build_ipk.sh missing"
[ -f scripts/build_apk.sh ] || fail "build_apk.sh missing"

grep -q 'ar r "$IPK_FILE" debian-binary control.tar.gz data.tar.gz' scripts/build_ipk.sh || \
	fail "ipk package must be an ar container for opkg"
grep -q 'IPK_FILE="$OUT_DIR/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_all.ipk"' scripts/build_ipk.sh || \
	fail "ipk filename must keep OpenWrt opkg naming"
grep -q '\${BUILD_RUN:-1}' scripts/build_ipk.sh || \
	fail "ipk package builder must allow workflow to skip duplicate run build"

grep -q 'PKG_VERSION_RELEASE="${PKG_VERSION}-r${PKG_RELEASE}"' scripts/build_apk.sh || \
	fail "apk version must use apk-tools VERSION-rRELEASE format"
grep -q 'PKG_ARCH="noarch"' scripts/build_apk.sh || \
	fail "apk arch must be noarch for all/LuCI packages"
grep -q 'APK_FILE="$OUT_DIR/${PKG_NAME}-${PKG_VERSION_RELEASE}.apk"' scripts/build_apk.sh || \
	fail "apk filename must keep OpenWrt apk naming"
grep -q '\${PKG_NAME}.conffiles_static' scripts/build_apk.sh || \
	fail "apk package must include conffiles_static metadata"
grep -q '\${PKG_NAME}.list' scripts/build_apk.sh || \
	fail "apk package must include installed file list metadata"

grep -q 'BUILD_RUN=0 sh scripts/build_ipk.sh dist' .github/workflows/build.yml || \
	fail "workflow must build run and ipk as separate artifacts"
grep -q 'Build .apk package' .github/workflows/build.yml || \
	fail "workflow must build apk package"
grep -q 'sh scripts/build_apk.sh dist' .github/workflows/build.yml || \
	fail "workflow must call apk package helper"
grep -q 'dist/\*.run dist/\*.ipk dist/\*.apk' .github/workflows/build.yml || \
	fail "workflow checksums must include run, ipk, and apk outputs"
grep -q 'OpenWrt 23.05-24.10 / opkg .ipk' .github/workflows/build.yml || \
	fail "release body must label ipk compatibility"
grep -q 'OpenWrt 25.12+ / apk .apk' .github/workflows/build.yml || \
	fail "release body must label apk compatibility"
grep -q 'luci-app-openclaw-${{ steps.version.outputs.version }}-r1.apk' .github/workflows/build.yml || \
	fail "release body must use apk-tools -r release suffix"

echo ok
