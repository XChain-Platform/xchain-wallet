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
#     # manifest-version: 2
#     # tag: v0.333.1
#     # tag-commit: <40-hex commit the tag resolves to>
#     # built: 2026-07-31T18:02:11Z
#     # dev-mock-gate: enforced | SKIPPED
#     # artifacts: 9
#     # profile default: ./xchain-wallet-web-v0.333.1.tar.gz
#     # profile store: ./xchain-wallet-ios-v0.333.1.ipa
#     <sha256>  ./xchain-wallet-web-v0.333.1.tar.gz
#     ...
#
# Version 2 added the profile lines . A build profile is which
# SET OF FEATURES was compiled in, and v1 has exactly two: `default`
# (web, desktop, extension) and `store` (the mobile store builds, which
# compile OUT the surfaces the app-store review posture hides, 
# §2.3). Two artifacts of one tag can therefore contain different code,
# and a record whose whole job is to prove what shipped could not say
# which was which. The mapping is one profile per artifact, taken from
# the same committed expected-artifacts.txt that gates the set, so it is
# a property of the declared release rather than of the machine.
#
# There is no version-1 compatibility branch: nothing has been published
# yet (RELEASE_HASHES/ holds no manifests), so a v1 reader would be dead
# code written for a file that does not exist.
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

# Absolute path to update-info.mjs, which owns the one definition of
# "is this file a channel pointer" ( §7.1). Resolved from this
# file's own location so sourcing from any cwd works.
xr_update_info_js() {
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    echo "$here/update-info.mjs"
}

# List the artifacts a manifest covers, as `./name`, LC_ALL=C sorted.
#
# Channel pointers are excluded: those are electron-updater's mutable
# pointers into the feed. They change whenever the channel is
# re-pointed (a rollback restores the PREVIOUS release's pointer, §6b),
# so covering them would make a rollback look like tampering and leave a
# signed manifest that no longer describes its own directory. Excluding
# them costs nothing in trust: the updater authenticates the ARTIFACT it
# downloaded against this manifest (packages/desktop/main/updateVerify.js),
# so a tampered pointer can only name bytes the manifest does not cover,
# and the install is refused.
#
# WHICH FILES THOSE ARE IS NOT A NAME GLOB. This used to exclude
# `latest*.yml`. The desktop build sets `channel: 'stable'`, so it emits
# `stable-mac.yml` and the glob matched NOTHING: every pointer was
# hashed into the manifest, and expected-artifacts.txt then hard-failed
# them as undeclared, which meant no desktop release could be signed at
# all. Widening the glob to `*.yml` would have been worse - a real build
# drops `builder-debug.yml` in the same directory. So the decision is
# delegated to update-info.mjs, which reads content, and there is exactly
# one implementation of it rather than one here and one in publish.sh.
xr_list_artifacts() {
    local dir="$1" js out
    js="$(xr_update_info_js)"

    if ! command -v node >/dev/null 2>&1; then
        echo "release/lib.sh: node not found; it decides which files are" >&2
        echo "  channel pointers rather than this script guessing by name." >&2
        return 2
    fi
    if [[ ! -f "$js" ]]; then
        echo "release/lib.sh: $js is missing." >&2
        echo "  Without it there is no artifact/pointer split at all, and the" >&2
        echo "  empty list that follows looks exactly like an empty staging" >&2
        echo "  directory. Refusing rather than reporting nothing." >&2
        return 2
    fi

    # Captured, not piped. Through a pipe the exit status belongs to sed,
    # so a crashed tool reports success with no output - indistinguishable
    # from a directory that legitimately holds nothing.
    if ! out="$(node "$js" artifacts "$dir")"; then
        echo "release/lib.sh: update-info.mjs failed to list $dir" >&2
        return 2
    fi
    printf '%s\n' "$out" | grep . | sed 's|^|./|' || true
}

# List the channel pointers in a directory, as `./name`, LC_ALL=C sorted.
# Empty output is a legitimate answer here; publish.sh is the caller that
# decides whether having none is a failure.
xr_list_update_info() {
    local dir="$1" js
    js="$(xr_update_info_js)"
    node "$js" pointers "$dir" 2>/dev/null | sed 's|^|./|'
}

# The build profiles a release may contain (; rails §3 owns the
# list). Adding a third is a spec change, not an implementation choice,
# because every reader of a manifest has to know what the name means.
XR_PROFILES=(default store)

# True if $1 is a declared profile name.
xr_is_profile() {
    local candidate="$1" p
    for p in "${XR_PROFILES[@]}"; do
        [[ "$candidate" == "$p" ]] && return 0
    done
    return 1
}

# Echo the build profile an artifact belongs to, per the expected list.
#
# Ambiguity is refused rather than resolved by order: if an artifact
# matches two globs that declare DIFFERENT profiles, the honest answer is
# that the list does not say which features it was built with, and
# picking the first match would write a guess into a signed record.
# Args: artifact_basename expected_file
xr_profile_for() {
    local name="${1#./}" expected="$2"
    local status pattern profile found=""

    while read -r status pattern profile _rest || [[ -n "$status" ]]; do
        case "$status" in ''|'#'*) continue ;; esac
        # shellcheck disable=SC2254  # $pattern is a glob by design.
        case "$name" in
            $pattern)
                if [[ -n "$found" && "$found" != "$profile" ]]; then
                    echo "release/lib.sh: '$name' matches globs declaring both" \
                         "'$found' and '$profile'; the list cannot say what it was built with." >&2
                    return 1
                fi
                found="$profile"
                ;;
        esac
    done < "$expected"

    if [[ -z "$found" ]]; then
        echo "release/lib.sh: no profile declared for artifact '$name'." >&2
        return 1
    fi
    echo "$found"
}

# Refuse a release that labels an artifact `store` before the store build
# profile exists as a build mechanism.
#
# Recording a profile is not producing one. The compile-time flags that
# make a `store` build differ from a `default` one are not written yet
# ( §2.3, first one named by ), so writing `store` into a
# signed, append-only record today would be a FALSE claim: a verifier would
# read it as "the review-hidden surfaces are absent" from a build that
# still contains them. That is worse than saying nothing, so it fails shut
# and the status file says how to open it.
# Args: dir expected_file
xr_assert_store_profile_buildable() {
    local dir="$1" expected="$2" here status name has_store=0

    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    while IFS= read -r name; do
        [[ -z "$name" ]] && continue
        [[ "$(xr_profile_for "$name" "$expected")" == "store" ]] && has_store=1
    done < <(xr_list_artifacts "$dir" | grep .)
    [[ "$has_store" -eq 0 ]] && return 0

    status="$(head -1 "$here/store-profile-status.txt" 2>/dev/null || true)"
    if [[ "$status" != IMPLEMENTED* ]]; then
        echo "release/lib.sh: this release stages a store-profile artifact, but the" >&2
        echo "  store build profile is not implemented (tools/release/store-profile-status.txt" >&2
        echo "  reads '${status:-<unreadable>}'). Signing would record a feature set the" >&2
        echo "  build does not actually have. See  /  §2.3." >&2
        return 1
    fi
}

# Write "$dir/RELEASE_HASHES.txt" with the signed header + sorted hashes.
# Args: dir tag tag_commit built_utc dev_mock_gate_state [expected_file]
#
# expected_file is optional ONLY for verify.sh --recompute, which writes a
# manifest already stamped "(none)" for tag and commit and announces
# itself as not a release. A real release always passes it: without it
# there are no profile lines, and sign.sh would be writing a v2 manifest
# that omits the one thing v2 exists for.
xr_write_manifest() {
    local dir="$1" tag="$2" commit="$3" built="$4" gate="$5" expected="${6:-}"
    local sha
    sha="$(xr_sha256_cmd)" || return 2

    local files count
    files="$(xr_list_artifacts "$dir")" || return 2
    count="$(printf '%s\n' "$files" | grep -c . || true)"

    if [[ "$count" -eq 0 ]]; then
        echo "release/lib.sh: no artifacts found in $dir - nothing to hash." >&2
        return 1
    fi

    # Resolved BEFORE the manifest is opened for writing: an undeclared or
    # ambiguous profile must leave no half-written manifest behind.
    #
    # ONE ARTIFACT PER LINE, not a space-separated list per profile.
    # electron-builder embeds productName in every desktop filename, so
    # half this release is called "XChain Wallet-0.333.1-x64.dmg"; a list
    # would have to be escaped to survive being read back, and an
    # escaping bug in a signed record is worse than a longer header.
    # Everything after the first ": " is exactly one name.
    local -a profile_lines=()
    if [[ -n "$expected" ]]; then
        local p name this
        for p in "${XR_PROFILES[@]}"; do
            while IFS= read -r name; do
                [[ -z "$name" ]] && continue
                this="$(xr_profile_for "$name" "$expected")" || return 1
                [[ "$this" == "$p" ]] && profile_lines+=("# profile $p: $name")
            done < <(printf '%s\n' "$files" | grep .)
        done
        if [[ ${#profile_lines[@]} -eq 0 ]]; then
            echo "release/lib.sh: no artifact resolved to a build profile." >&2
            return 1
        fi
    fi

    {
        echo "# XChain Wallet release manifest"
        echo "# manifest-version: 2"
        echo "# tag: $tag"
        echo "# tag-commit: $commit"
        echo "# built: $built"
        echo "# dev-mock-gate: $gate"
        echo "# artifacts: $count"
        [[ ${#profile_lines[@]} -gt 0 ]] && printf '%s\n' "${profile_lines[@]}"
    } > "$dir/RELEASE_HASHES.txt"

    (
        cd "$dir" || exit 2
        # shellcheck disable=SC2086  # $sha is a command + flags, must split.
        printf '%s\n' "$files" | grep . | xargs -I{} $sha {} \
            >> "RELEASE_HASHES.txt"
    ) || return 2
}

# Check that a manifest's profile lines account for its artifacts exactly
# once each, and name only declared profiles.
#
# This is the read side of  and needs no repo: the claim is inside
# the signed bytes. What it catches is the case the field exists for, an
# artifact quietly added to (or dropped from) a release whose feature set
# the header still describes as before.
# Args: manifest_path stripped_manifest_path
xr_check_profiles() {
    local manifest="$1" stripped="$2"
    local -a covered=()
    local line body profile name seen

    while IFS= read -r line; do
        body="${line#\# profile }"
        profile="${body%%: *}"
        name="${body#*: }"
        if ! xr_is_profile "$profile"; then
            echo "verify: manifest names an undeclared build profile: '$profile'" >&2
            return 1
        fi
        if [[ -z "$name" || "$name" == "$body" ]]; then
            echo "verify: unreadable profile line: $line" >&2
            return 1
        fi
        for seen in "${covered[@]:-}"; do
            if [[ "$seen" == "$name" ]]; then
                echo "verify: '$name' is claimed by more than one build profile." >&2
                return 1
            fi
        done
        covered+=("$name")
    done < <(grep '^# profile ' "$manifest" || true)

    if [[ ${#covered[@]} -eq 0 ]]; then
        echo "verify: manifest carries no profile lines, so it does not say which" >&2
        echo "  feature set each artifact was built with (manifest-version 2, )." >&2
        return 1
    fi

    # Both directions, for the same reason the artifact-set gate runs both:
    # an uncovered artifact is one whose feature set nobody declared, and a
    # covered-but-absent one means the manifest describes bytes it does not
    # hash.
    local hashed
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        hashed="${line#*  }"
        local found=0
        for name in "${covered[@]}"; do
            [[ "$name" == "$hashed" ]] && { found=1; break; }
        done
        if [[ "$found" -eq 0 ]]; then
            echo "verify: '$hashed' is hashed but belongs to no build profile." >&2
            return 1
        fi
    done < "$stripped"

    for name in "${covered[@]}"; do
        if ! grep -qF "  ${name}" "$stripped"; then
            echo "verify: profile lines claim '$name', which the manifest does not hash." >&2
            return 1
        fi
    done
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
    local status pattern profile
    # `|| [[ -n "$status" ]]` so a file with no trailing newline does not
    # silently drop its last row - which, in this file, would mean
    # silently dropping a required artifact.
    while read -r status pattern profile _rest || [[ -n "$status" ]]; do
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
        # The profile column is checked HERE, at parse time, rather than
        # when a manifest is written: a missing one is a stale list, and
        # the release that discovers it should be the one being declared,
        # not the one already staged and waiting for a signature.
        if ! xr_is_profile "$profile"; then
            echo "release/lib.sh: $expected: '$pattern' declares profile" \
                 "'${profile:-<missing>}'; expected one of: ${XR_PROFILES[*]}" >&2
            return 1
        fi
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
