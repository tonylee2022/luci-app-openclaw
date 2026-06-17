#!/bin/sh

oc_prepare_backup_restore() {
	local archive="$1"
	local state_dir="$2"
	local staging="$3"
	local list_file="$staging/archive.list"
	local verbose_file="$staging/archive.verbose"
	local first_entry prefix state_rel payload_root restore_root entry

	tar -tzf "$archive" > "$list_file" 2>/dev/null || return 1
	tar -tvzf "$archive" > "$verbose_file" 2>/dev/null || return 1

	first_entry=$(sed -n '1p' "$list_file")
	prefix=${first_entry%%/*}
	[ -n "$prefix" ] || return 1
	case "$prefix" in
		.|..|*/*|*\\*) return 1 ;;
	esac

	state_rel=${state_dir#/}
	payload_root="$prefix/payload/posix"
	restore_root="$payload_root/$state_rel"

	while IFS= read -r entry; do
		[ -n "$entry" ] || return 1
		entry_base=${entry%/}
		case "$restore_root/" in
			"$entry_base/"*) continue ;;
		esac
		case "$entry" in
			/*|*\\*|*//*|*/../*|../*|*/..|*/./*|./*) return 1 ;;
		esac
		case "$entry" in
			"$prefix"|"$prefix/"|"$prefix/manifest.json"|"$payload_root"|"$payload_root/"|"$restore_root"|"$restore_root/"|"$restore_root"/*) ;;
			"$payload_root"/*) return 1 ;;
			"$prefix"/*) ;;
			*) return 1 ;;
		esac
	done < "$list_file"

	if awk '$1 ~ /^[lhbcp]/ { found=1 } END { exit(found ? 0 : 1) }' "$verbose_file"; then
		return 1
	fi

	mkdir -p "$staging/extract" || return 1
	tar -xzf "$archive" -C "$staging/extract" "$restore_root" 2>/dev/null || return 1
	[ -d "$staging/extract/$restore_root" ] || return 1
	if find "$staging/extract/$restore_root" \( -type l -o -type b -o -type c -o -type p -o -type s \) | grep -q .; then
		return 1
	fi

	printf '%s\n' "$staging/extract/$restore_root"
}
