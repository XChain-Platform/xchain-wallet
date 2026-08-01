#!/usr/bin/env bash
#*********************************************************************
#
# Copyright © 2025-2026 Dankest, LLC
# Based on XChain Platform by Dankest, LLC - https://dankest.llc
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# This file is part of XChain Platform. Licensed under the GNU Affero
# General Public License v3.0 or later; see LICENSE.md. A commercial
# license (without AGPL source-disclosure terms) is available -
# contact legal@dankest.llc.
#
#*********************************************************************

# tools/release/lib.sh - shared manifest routines for sign.sh + verify.sh.
#
# Sourced, never executed. Exists because sign.sh and verify.sh both
# have to agree, byte for byte, on what a release manifest is: which
# files it covers, what order they appear in, and what its header says.
# They each carried their own copy of the find|sort|hash pipeline, which
# is a silent-divergence trap - the day one grew an exclusion and the
# other did not, verify.sh would report a mismatch on a perfectly good
# release, or worse, pass one that sign.sh had not actually covered.
#
# Manifest format ( §6 hardening):
#
#     # XChain Wallet release manifest
#     # manifest-version: 1
#     # tag: v0.333.1
#     # tag-commit: <40-hex commit the tag resolves to>
#     # built: 2026-07-31T18:02:11Z
#     # dev-mock-gate: enforced | SKIPPED
#     # artifacts: 9
#     <sha256>  ./xchain-wallet-web-v0.333.1.tar.gz
#     ...
#
# The header is inside the signed bytes on purpose: a manifest whose
# version is not covered by the signature can be lifted from one release
# and served as another, and every hash in it would still check out. The
# `#` lines are ignored by `shasum -c`; GNU `sha256sum -c` checks them
# but prints "improperly formatted lines" and still exits 0, so verify.sh
# strips them before checking rather than making users read a warning that
# means nothing.

# Echo the sha256 command for this platform, or fail.
xr_sha256_cmd() {
    if command -v sha256sum >/dev/null 2>&1; then
        echo "sha256sum"
    elif command -v shasum >/dev/null 2>&1; then
        echo "shasum -a 256"
    else
        echo "release/lib.sh: neither sha256sum nor shasum found" >&2
        return 2
    fi
}

# List the artifacts a manifest covers, as `./name`, LC_ALL=C sorted.
#
# `latest*.yml` is excluded: those are electron-updater's mutable
# pointers into the feed. They change whenever the channel is
# re-pointed (a rollback rewrites latest.yml to the PREVIOUS release,
# §6b), so covering them would make a rollback look like tampering and
# leave a signed manifest that no longer describes its own directory.
xr_list_artifacts() {
    local dir="$1"
    (
        cd "$dir" || return 2
        find . -maxdepth 1 -type f \
            ! -name 'RELEASE_HASHES.txt' \
            ! -name 'RELEASE_HASHES.txt.asc' \
            ! -name 'latest*.yml' \
            | LC_ALL=C sort
    )
}

# Write "$dir/RELEASE_HASHES.txt" with the signed header + sorted hashes.
# Args: dir tag tag_commit built_utc dev_mock_gate_state
xr_write_manifest() {
    local dir="$1" tag="$2" commit="$3" built="$4" gate="$5"
    local sha
    sha="$(xr_sha256_cmd)" || return 2

    local files count
    files="$(xr_list_artifacts "$dir")" || return 2
    count="$(printf '%s\n' "$files" | grep -c . || true)"

    if [[ "$count" -eq 0 ]]; then
        echo "release/lib.sh: no artifacts found in $dir - nothing to hash." >&2
        return 1
    fi

    {
        echo "# XChain Wallet release manifest"
        echo "# manifest-version: 1"
        echo "# tag: $tag"
        echo "# tag-commit: $commit"
        echo "# built: $built"
        echo "# dev-mock-gate: $gate"
        echo "# artifacts: $count"
    } > "$dir/RELEASE_HASHES.txt"

    (
        cd "$dir" || exit 2
        # shellcheck disable=SC2086  # $sha is a command + flags, must split.
        printf '%s\n' "$files" | grep . | xargs -I{} $sha {} \
            >> "RELEASE_HASHES.txt"
    ) || return 2
}

# Echo one header field's value from a manifest, empty if absent.
# Args: manifest_path field_name
xr_header_field() {
    local manifest="$1" field="$2"
    sed -n "s/^# ${field}: //p" "$manifest" | head -1
}

# True if the manifest carries the signed header at all.
xr_has_header() {
    grep -q '^# manifest-version: ' "$1" 2>/dev/null
}

# Reject a manifest whose hash lines are not well-formed.
#
# This is NOT belt-and-braces, it closes a real hole. macOS ships
# /sbin/sha256sum, whose `-c` prints "N lines are improperly formatted"
# and then EXITS 0 - even when every single line was malformed and
# nothing at all was verified. A manifest with mangled hash lines
# therefore "passes" the check on a Mac while proving nothing. GNU
# coreutils has --strict for this; shasum does not take the flag the
# same way, so relying on either tool's flags is not portable.
#
# Enforcing the format here, before the tool runs, makes the guarantee
# ours instead of the platform's: 64 hex digits, two spaces, a name.
# Args: stripped_manifest_path
xr_assert_wellformed() {
    local file="$1" lineno=0 bad=0 line
    # Held in a variable: an inline regex with literal spaces is a
    # portability trap across bash versions.
    local re='^[0-9a-fA-F]{64}  .+$'
    while IFS= read -r line; do
        lineno=$((lineno + 1))
        [[ -z "$line" ]] && continue
        if [[ ! "$line" =~ $re ]]; then
            echo "MALFORMED  line $lineno is not a sha256 checksum line: $line" >&2
            bad=$((bad + 1))
        fi
    done < "$file"
    if [[ "$bad" -gt 0 ]]; then
        echo >&2
        echo "release/lib.sh: $bad malformed manifest line(s); refusing to check." >&2
        echo "  A checksum tool may skip these and still report success." >&2
        return 1
    fi
}

# Gate the staged artifact set against the committed expected list.
#
# Two directions, and both matter. A missing REQUIRED pattern means a
# shell did not build (or was never staged) and the manifest would look
# perfectly clean while covering half a release. An artifact matching NO
# pattern means something is in the signing input that no one declared -
# a stray build output, a leftover from the previous version, a file an
# attacker dropped into the staging dir. Signing either one launders it
# into the release's trust root.
#
# Args: dir expected_file
xr_check_expected() {
    local dir="$1" expected="$2"

    if [[ ! -f "$expected" ]]; then
        echo "release/lib.sh: expected-artifact list not found: $expected" >&2
        echo "  This list is what stops a partially-populated directory from" >&2
        echo "  producing a clean-looking manifest. It is not optional." >&2
        return 1
    fi

    local -a req_pats=() opt_pats=()
    local status pattern
    # `|| [[ -n "$status" ]]` so a file with no trailing newline does not
    # silently drop its last row - which, in this file, would mean
    # silently dropping a required artifact.
    while read -r status pattern _rest || [[ -n "$status" ]]; do
        case "$status" in
            ''|'#'*) continue ;;
            required) req_pats+=("$pattern") ;;
            optional) opt_pats+=("$pattern") ;;
            *)
                echo "release/lib.sh: $expected: unknown status '$status'" \
                     "(expected 'required' or 'optional')" >&2
                return 1
                ;;
        esac
    done < "$expected"

    if [[ ${#req_pats[@]} -eq 0 ]]; then
        echo "release/lib.sh: $expected declares no required artifacts." >&2
        return 1
    fi

    local -a artifacts=()
    local line
    while IFS= read -r line; do
        [[ -n "$line" ]] && artifacts+=("${line#./}")
    done < <(xr_list_artifacts "$dir")

    local failures=0 name pat matched

    for pat in "${req_pats[@]}"; do
        matched=0
        for name in "${artifacts[@]:-}"; do
            # shellcheck disable=SC2254  # $pat is a glob by design.
            case "$name" in $pat) matched=1; break ;; esac
        done
        if [[ "$matched" -eq 0 ]]; then
            echo "MISSING  no artifact matches required pattern: $pat" >&2
            failures=$((failures + 1))
        fi
    done

    for name in "${artifacts[@]:-}"; do
        [[ -z "$name" ]] && continue
        matched=0
        for pat in "${req_pats[@]}" "${opt_pats[@]:-}"; do
            [[ -z "$pat" ]] && continue
            # shellcheck disable=SC2254  # $pat is a glob by design.
            case "$name" in $pat) matched=1; break ;; esac
        done
        if [[ "$matched" -eq 0 ]]; then
            echo "UNDECLARED  artifact matches no pattern in the list: $name" >&2
            failures=$((failures + 1))
        fi
    done

    if [[ "$failures" -gt 0 ]]; then
        echo >&2
        echo "release/lib.sh: artifact-set gate FAILED ($failures problem(s))." >&2
        echo "  Checked against: $expected" >&2
        echo "  Either the staging directory is wrong, or the list is stale." >&2
        echo "  If the artifact set genuinely changed, update the list in the" >&2
        echo "  same commit that changed it." >&2
        return 1
    fi

    echo "release/lib.sh: artifact-set gate ok (${#artifacts[@]} artifact(s))." >&2
}
