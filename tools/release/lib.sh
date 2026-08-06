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

# "Sourced, never executed" is a true statement about intent and was not a
# true statement about behaviour: `bash tools/release/lib.sh --help` defined
# every function below and exited 0 with no output, which is the exact shape
# the §13 gate now refuses - a script that answers a question by doing
# something and returning success . A sourced-only file is still a
# file an operator can find and run, and the useful answer to running it is
# "you cannot; here is what sources me".
#
# ${0} is the executing script and BASH_SOURCE[0] is this file, so they are
# equal only under direct execution. Under `source` they differ and nothing
# here fires, whatever $1 the sourcing script happens to be holding.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    cat <<'USAGE'
lib.sh - shared release-manifest routines for sign.sh and verify.sh.

Usage:
  Not runnable. This file is sourced, never executed:

      source tools/release/lib.sh

  It defines xr_* helpers and runs nothing on its own. To do the work it
  supports, use the tools that source it:

      bash tools/release/sign.sh   --tag vX.Y.Z --input <dir>
      bash tools/release/verify.sh --tag vX.Y.Z --input <dir>

It exists so those two agree byte for byte on what a release manifest is:
which files it covers, in what order, and what its header says. Each used
to carry its own copy of the find|sort|hash pipeline, and the day one grew
an exclusion the other did not, verify.sh would either fail a good release
or pass one sign.sh had not covered.
USAGE
    exit 0
fi

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
# Args: dir tag tag_commit built_utc dev_mock_gate_state [expected_file] [lanes]
#
# `lanes` is set only for a PARTIAL release (, sign.sh --lane) and
# writes two header fields, `coverage: partial` and `lanes: <names>`. A
# full release writes neither, so a manifest that says nothing about
# coverage is a full one - and since the signature covers these bytes,
# stripping the fields to pass a partial manifest off as complete breaks
# the signature rather than the claim.
#
# expected_file is optional ONLY for verify.sh --recompute, which writes a
# manifest already stamped "(none)" for tag and commit and announces
# itself as not a release. A real release always passes it: without it
# there are no profile lines, and sign.sh would be writing a v2 manifest
# that omits the one thing v2 exists for.
xr_write_manifest() {
    local dir="$1" tag="$2" commit="$3" built="$4" gate="$5" expected="${6:-}"
    local lanes="${7:-}"
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
    # half this release is called "xchain-wallet-0.333.1-x64.dmg"; a list
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
        if [[ -n "$lanes" ]]; then
            echo "# coverage: partial"
            echo "# lanes: $lanes"
        fi
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

# Does this manifest claim to describe an actual release?
#
# `verify.sh --recompute` writes a manifest that announces itself as NOT a
# release by stamping "(none)" for tag and tag-commit (see xr_write_manifest),
# and such a manifest deliberately carries no build-profile lines because
# there is no release whose feature set it could be claiming.
#
# This exists because xr_has_header could not tell the two apart: a recompute
# manifest carries the same "# manifest-version: 2" line a signed one does,
# so gating the profile check on a header ran it against exactly the manifests
# that are documented not to have profiles. verify.sh therefore refused to
# read its own --recompute output, on any tag (found 2026-08-02 by running the
# ceremony's Phase 4 step against the real v0.334.0 CI artifact). That matters
# more than it looks: signing is still blocked on the release-key ceremony, so
# --recompute is the ONLY way an operator can hash-verify an artifact today.
# Args: manifest_path
xr_is_release_manifest() {
    local tag
    xr_has_header "$1" || return 1
    tag="$(xr_header_field "$1" 'tag')"
    [[ -n "$tag" && "$tag" != "(none)" ]]
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

# What the arch column may say. The first four are architectures; the
# shipped matrix is x64 + arm64 ( §2) and the other two are here so
# that the day DD1 adds armv7l, or DD3 flips macOS to a universal binary,
# the change is one column rather than a code change.
#
# `multi` is not an architecture. It names an artifact that carries MORE
# THAN ONE arch and therefore belongs to no lane - electron-builder's
# combined NSIS installer is the only one we have seen . It is an
# ALLOWANCE, never a requirement: a row may declare it to say "an
# un-suffixed combined artifact here is deliberate", and the gate then
# tolerates one, but it never demands one, because a combined artifact is
# by definition not a lane anybody updates.
XR_ARCH_TOKENS=(x64 arm64 armv7l universal multi)

# True if $1 is a token the arch column may carry.
xr_is_arch_token() {
    local candidate="$1" a
    for a in "${XR_ARCH_TOKENS[@]}"; do
        [[ "$candidate" == "$a" ]] && return 0
    done
    return 1
}

# Echo the architecture an artifact's NAME attributes it to, or nothing.
#
# The names are electron-builder's, and the mapping is its own
# (`builder-util/out/arch.js: getArtifactArchName`), verified against the
# installed 26.15.7 rather than remembered: x64 becomes `amd64` for deb,
# `x86_64` for AppImage/rpm/flatpak, and stays `x64` everywhere else.
#
# THE EMPTY ANSWER IS THE LOAD-BEARING ONE. An artifact with no arch token
# is not "probably the default arch" - it is a file the gate cannot assign
# to a fleet, and the caller fails on it. That is what catches the combined
# Windows installer, which is the same shape as a naming bug and must not
# be waved through as either.
#
# THE APPIMAGE EXCEPTION IS GONE, and that is the whole point of §7.1's
# rename (2026-08-02). This function used to read a bare
# `xchain-wallet-<v>.AppImage` as the x64 build, because
# `expandArtifactNamePattern` drops the arch token for the DEFAULT arch
# unless the artifactName is user-forced, and that target was the one left
# unforced. It is forced now, so the x64 AppImage arrives as
# `xchain-wallet-<v>-x86_64.AppImage` and is read by the `x86_64` rule
# above like everything else.
#
# The exception was removed rather than left as a harmless backstop,
# because it stopped being harmless the moment it stopped being true: an
# un-suffixed AppImage now means the forced name was LOST, which is the
# same class of event as the combined NSIS installer reappearing
# (). Inferring x64 would wave that through; refusing to
# attribute it fails the release loudly, which is what the paragraph above
# says the empty answer is for.
#
# The arches we do NOT ship are recognised on purpose. An armv7l or
# universal artifact must not fall through to the AppImage exception and
# be counted as the x64 build - that would let a lane satisfy the x64
# requirement with a file no x64 machine can run. Named, it reports as an
# arch the row does not declare, which is the true answer.
xr_artifact_arch() {
    local name="${1#./}"
    case "$name" in
        *arm64*|*aarch64*) echo arm64; return 0 ;;
        *armv7l*|*armhf*) echo armv7l; return 0 ;;
        *universal*) echo universal; return 0 ;;
        *i386*|*i686*|*ia32*) echo ia32; return 0 ;;
        *x86_64*|*amd64*|*-x64*|*_x64*) echo x64; return 0 ;;
    esac
    echo ""
}

# Check one declared row's per-architecture coverage.
#
# Prints a problem count on stdout and the problems themselves on stderr,
# so the caller's failure tally stays one-per-problem the way the rest of
# the gate counts.
#
# Args: pattern archspec required(1|0) artifact...
xr_check_arch_row() {
    local pattern="$1" archspec="$2" required="$3"
    shift 3

    if [[ "$archspec" == "-" ]]; then
        echo 0
        return 0
    fi

    local -a want=() seen=()
    local tok name arch a found dup problems=0 matched_any=0 allow_multi=0

    # Split on commas via tr rather than by reassigning IFS: this function
    # runs inside a command substitution under `set -e`, where a stray
    # non-zero status is fatal, so the body stays deliberately boring.
    for tok in $(printf '%s' "$archspec" | tr ',' ' '); do
        if [[ "$tok" == "multi" ]]; then
            allow_multi=1
        else
            want+=("$tok")
        fi
    done

    for name in "$@"; do
        if [[ -z "$name" ]]; then continue; fi
        # shellcheck disable=SC2254  # $pattern is a glob by design.
        case "${name#./}" in $pattern) ;; *) continue ;; esac
        matched_any=1
        arch="$(xr_artifact_arch "$name")"

        if [[ -z "$arch" ]]; then
            if [[ "$allow_multi" -eq 1 ]]; then continue; fi
            echo "UNATTRIBUTED  '${name#./}' matches required pattern '$pattern' but" >&2
            echo "              carries no architecture token, so nothing can say which" >&2
            echo "              fleet it is for. electron-builder emits an un-suffixed" >&2
            echo "              COMBINED NSIS installer holding both arches, and the" >&2
            echo "              generated stable.yml points every Windows client at it" >&2
            echo "              . Decide it rather than ship it: stop emitting" >&2
            echo "              the file, or add 'multi' to this row's arch column to" >&2
            echo "              declare it deliberate." >&2
            problems=$((problems + 1))
            continue
        fi

        found=0
        for a in "${want[@]:-}"; do
            if [[ "$a" == "$arch" ]]; then found=1; fi
        done
        if [[ "$found" -eq 0 ]]; then
            echo "UNEXPECTED-ARCH  '${name#./}' is a $arch artifact, but '$pattern'" >&2
            echo "              declares only: $archspec" >&2
            problems=$((problems + 1))
            continue
        fi

        # TWO ARTIFACTS CLAIMING ONE ARCHITECTURE, which the coverage
        # check below cannot see: it only asks whether each arch appears
        # AT LEAST once, so a duplicate reads as healthy.
        #
        # The live example is electron-builder's NSIS uninstaller
        # intermediate, `<name>-x64.__uninstaller.exe`, ~100M and sitting
        # in `dist/` next to the installer while the build runs. A
        # successful run removes it (measured on a real Windows build,
        # 2026-08-02), so this is not a bug we have - it is the one we
        # would have had no way to see: it matches `*.exe`, classifies as
        # x64, and would have been hashed into the manifest and uploaded
        # to the feed as a second, unrunnable "installer".
        #
        # The honest answer is that the list cannot say which of two is
        # the release artifact, so it refuses instead of picking.
        dup=0
        for a in "${seen[@]:-}"; do
            if [[ "$a" == "$arch" ]]; then dup=1; fi
        done
        if [[ "$dup" -eq 1 ]]; then
            echo "DUPLICATE-ARCH  two artifacts matching '$pattern' claim $arch;" >&2
            echo "              '${name#./}' is the second." >&2
            echo "              Nothing can say which one is the release artifact, so" >&2
            echo "              this refuses rather than picking. A build intermediate" >&2
            echo "              left in the staging directory is the usual cause." >&2
            problems=$((problems + 1))
            continue
        fi
        seen+=("$arch")
    done

    # An optional row that produced nothing is the case it exists for.
    if [[ "$required" -eq 0 && "$matched_any" -eq 0 ]]; then
        echo "$problems"
        return 0
    fi

    for a in "${want[@]:-}"; do
        if [[ -z "$a" ]]; then continue; fi
        found=0
        for arch in "${seen[@]:-}"; do
            if [[ "$arch" == "$a" ]]; then found=1; fi
        done
        if [[ "$found" -eq 0 ]]; then
            echo "MISSING-ARCH  pattern '$pattern' has no $a artifact (declared: $archspec)." >&2
            echo "              The glob matches the other architecture happily, which is" >&2
            echo "              how a release that built ONE arch passed this gate before" >&2
            echo "              ( §8). That release leaves every $a install with no" >&2
            echo "              download and no update, and writes no ${a}-suffixed" >&2
            echo "              channel pointer for anything to fetch." >&2
            problems=$((problems + 1))
        fi
    done

    echo "$problems"
}

# Gate the staged artifact set against the committed expected list.
#
# Three directions now, and all matter. A missing REQUIRED pattern means a
# shell did not build (or was never staged) and the manifest would look
# perfectly clean while covering half a release. An artifact matching NO
# pattern means something is in the signing input that no one declared -
# a stray build output, a leftover from the previous version, a file an
# attacker dropped into the staging dir. Signing either one launders it
# into the release's trust root.
#
# THE THIRD DIRECTION IS PER-ARCHITECTURE, and it was missing until
# 2026-08-01 ( §8). The globs are extension-shaped on purpose, so
# `*.dmg` is satisfied by ONE dmg: a release that built x64 and silently
# dropped arm64 - which is exactly what the `--` argv bug did to all six
# lanes - passed this gate with a clean manifest. The arch column closes
# it, and catches the opposite defect too: an artifact that belongs to no
# architecture at all .
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

    local -a req_pats=() opt_pats=() req_arch=() opt_arch=()
    local status pattern profile arches tok
    # `|| [[ -n "$status" ]]` so a file with no trailing newline does not
    # silently drop its last row - which, in this file, would mean
    # silently dropping a required artifact.
    while read -r status pattern profile arches _rest || [[ -n "$status" ]]; do
        case "$status" in
            ''|'#'*) continue ;;
            required) req_pats+=("$pattern"); req_arch+=("$arches") ;;
            optional) opt_pats+=("$pattern"); opt_arch+=("$arches") ;;
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
        # Same argument for the arch column, and one more: an EMPTY one
        # would silently restore the pre-2026-08-01 behaviour on that row,
        # which is the failure this column exists to end. `-` is the way to
        # say "this artifact is not arch-partitioned", out loud.
        if [[ -z "$arches" ]]; then
            echo "release/lib.sh: $expected: '$pattern' declares no arch column." >&2
            echo "  Use '-' for an artifact with no architecture split (the web" >&2
            echo "  tarball, the extension zip, a universal mobile build), or a" >&2
            echo "  comma-separated set from: ${XR_ARCH_TOKENS[*]}" >&2
            return 1
        fi
        if [[ "$arches" != "-" ]]; then
            for tok in $(printf '%s' "$arches" | tr ',' ' '); do
                if ! xr_is_arch_token "$tok"; then
                    echo "release/lib.sh: $expected: '$pattern' declares arch" \
                         "'$tok'; expected one of: ${XR_ARCH_TOKENS[*]} (or '-')" >&2
                    return 1
                fi
            done
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

    local failures=0 name pat matched i n

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

    # Per-arch coverage, for the rows that declare one. Runs even when a
    # row matched nothing above: the two messages answer different
    # questions ("did this shell build?" vs "did it build both arches?")
    # and a release missing one arch of one lane should read as exactly
    # that rather than inherit the other row's wording.
    # Indexed by counter rather than `${!arr[@]}`: under `set -u` an empty
    # array is an error in the bash versions this repo still targets (see
    # publish.sh on mapfile), and `opt_pats` is legitimately empty when a
    # list declares nothing optional.
    i=0
    while [[ "$i" -lt "${#req_pats[@]}" ]]; do
        n="$(xr_check_arch_row "${req_pats[$i]}" "${req_arch[$i]}" 1 "${artifacts[@]:-}")"
        failures=$((failures + n))
        i=$((i + 1))
    done
    i=0
    while [[ "$i" -lt "${#opt_pats[@]}" ]]; do
        n="$(xr_check_arch_row "${opt_pats[$i]}" "${opt_arch[$i]}" 0 "${artifacts[@]:-}")"
        failures=$((failures + n))
        i=$((i + 1))
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

# Gate a release against the lanes that have already shipped.
#
# xr_check_expected above answers "does this release contain everything
# the list demands", and every store lane is declared `optional` there
# because a lane that has never shipped cannot be demanded of a release
# built before it existed. This function answers the question that
# becomes live the day one of them DOES ship: has a lane that already has
# users silently dropped out of this release?
#
# The gap is real and it is the  §8 shape one level up. Nothing
# about a first upload edits expected-artifacts.txt, so the release AFTER
# the first Android release could omit the Android pair and produce a
# manifest that is internally perfect while leaving every direct-APK
# install without the fix it was told to expect.  §6 states the
# invariant ("never let the direct lane lag"); this is the mechanism.
#
# Fail-shut in both directions, because a gate that reads a stale or
# unclaimed declaration and shrugs is the gate that was already missing:
# an unknown status, a glob that no expected-artifacts row declares, and
# an `optional` row that no lane claims are all hard failures.
#
# A FOURTH ARGUMENT NARROWS IT TO A PARTIAL RELEASE . When a
# release covers only some lanes - the Android pair signed on its own
# while the desktop lanes are not built - the parity question is asked of
# the lanes in that scope and of nothing else, because a lane the release
# never claimed to cover cannot have been dropped from it. The two DRIFT
# checks below are deliberately NOT narrowed: they are about whether the
# two committed files agree with each other, which is true or false
# independently of what is being signed today.
#
# Args: dir lanes_file expected_file [scope]
#       scope: space-separated lane names; empty means every lane.
xr_check_shipped_lanes() {
    local dir="$1" lanes="$2" expected="$3" scope="${4:-}"

    if [[ ! -f "$lanes" ]]; then
        echo "release/lib.sh: shipped-lane list not found: $lanes" >&2
        echo "  This list is what stops a lane that already has users from" >&2
        echo "  dropping out of a release unnoticed. It is not optional." >&2
        return 1
    fi

    # Every glob expected-artifacts.txt declares, and separately the
    # `optional` subset, so both drift directions can be checked.
    local -a all_pats=() opt_pats=()
    local status pattern
    while read -r status pattern _rest || [[ -n "$status" ]]; do
        case "$status" in
            ''|'#'*) continue ;;
            required) all_pats+=("$pattern") ;;
            optional) all_pats+=("$pattern"); opt_pats+=("$pattern") ;;
        esac
    done < "$expected"

    local -a artifacts=()
    local line
    while IFS= read -r line; do
        [[ -n "$line" ]] && artifacts+=("${line#./}")
    done < <(xr_list_artifacts "$dir")

    local failures=0 lane lstatus rest pat p name matched claimed
    local -a claimed_pats=()

    while read -r lane lstatus rest || [[ -n "$lane" ]]; do
        case "$lane" in ''|'#'*) continue ;; esac

        if [[ "$lstatus" != "SHIPPED" && "$lstatus" != "NOT-SHIPPED" ]]; then
            echo "release/lib.sh: $lanes: lane '$lane' declares status" \
                 "'${lstatus:-<missing>}'; expected SHIPPED or NOT-SHIPPED." >&2
            echo "  Not defaulted to the permissive one on purpose: a typo must" >&2
            echo "  not quietly disarm the parity requirement it was editing." >&2
            return 1
        fi
        if [[ -z "$rest" ]]; then
            echo "release/lib.sh: $lanes: lane '$lane' declares no artifact glob." >&2
            return 1
        fi

        for pat in $rest; do
            # Drift direction 1: this file must not describe artifacts the
            # release list has never heard of.
            matched=0
            for p in "${all_pats[@]:-}"; do
                [[ "$pat" == "$p" ]] && matched=1
            done
            if [[ "$matched" -eq 0 ]]; then
                echo "release/lib.sh: $lanes: lane '$lane' claims glob '$pat'," \
                     "which no row of $expected declares." >&2
                echo "  The two files would be describing different releases." >&2
                return 1
            fi
            claimed_pats+=("$pat")

            [[ "$lstatus" == "SHIPPED" ]] || continue

            # Out of scope on a partial release: this release never
            # claimed to carry the lane, so its absence is not a lane
            # left behind. Matched against a space-padded scope so
            # `android` does not also match a lane called `androidtv`.
            if [[ -n "$scope" && " $scope " != *" $lane "* ]]; then
                continue
            fi

            matched=0
            for name in "${artifacts[@]:-}"; do
                # shellcheck disable=SC2254  # $pat is a glob by design.
                case "$name" in $pat) matched=1; break ;; esac
            done
            if [[ "$matched" -eq 0 ]]; then
                echo "LANE-REGRESSION  lane '$lane' has shipped, but this release" \
                     "stages no artifact matching '$pat'." >&2
                echo "                 Users of that lane are already installed and" >&2
                echo "                 expect this version. Shipping without it is not" >&2
                echo "                 a smaller release, it is a lane left behind on a" >&2
                echo "                 version nothing will ever update ( §6)." >&2
                echo "                 If the lane is genuinely being retired, say so in" >&2
                echo "                 $lanes rather than here." >&2
                failures=$((failures + 1))
            fi
        done
    done < "$lanes"

    # Drift direction 2, and it is the one that keeps this file honest as
    # new lanes appear: an optional artifact belonging to no declared lane
    # has no shipping state at all, which is exactly the hole this gate
    # was added to close.
    for p in "${opt_pats[@]:-}"; do
        claimed=0
        for pat in "${claimed_pats[@]:-}"; do
            [[ "$p" == "$pat" ]] && claimed=1
        done
        if [[ "$claimed" -eq 0 ]]; then
            echo "release/lib.sh: $expected declares '$p' optional, but no lane in" \
                 "$lanes claims it." >&2
            echo "  An optional artifact with no shipping state can never become" >&2
            echo "  required, so the release after its first one could drop it" >&2
            echo "  silently. Add it to a lane." >&2
            return 1
        fi
    done

    if [[ "$failures" -gt 0 ]]; then
        echo >&2
        echo "release/lib.sh: shipped-lane gate FAILED ($failures problem(s))." >&2
        echo "  Checked against: $lanes" >&2
        return 1
    fi

    if [[ -n "$scope" ]]; then
        echo "release/lib.sh: shipped-lane gate ok (scope: $scope; lanes outside" \
             "it were not checked, because this release does not claim them)." >&2
        return 0
    fi
    echo "release/lib.sh: shipped-lane gate ok." >&2
}

# Restrict an expected-artifact list to the lanes a PARTIAL release covers,
# and print the restricted list on stdout .
#
# WHY A PARTIAL RELEASE EXISTS AT ALL. sign.sh signs one manifest for a
# whole release and xr_check_expected demands every `required` row - web,
# extension, and both architectures of six desktop artifacts. On
# 2026-08-06 the Android ceremony produced a real signed AAB and APK and
# the step after it, signing the manifest, could not run: an Android-only
# directory fails that gate with twenty problems, and the ceremony's own
# closing line told the operator to run exactly that command. A lane whose
# artifacts are ready must be publishable without waiting for lanes that
# are not.
#
# WHY IT IS DERIVED RATHER THAN PASSED. The scope is computed from
# shipped-lanes.txt, which is committed, reviewed, and already the single
# place a lane's identity is declared. A `--glob` flag would let the
# command line decide what a release contains, which is the property this
# gate exists to take AWAY from the command line.
#
# WHY IT IS STRICTER INSIDE ITS SCOPE, not weaker:
#
#   * every glob the named lanes claim is emitted as `required`, even
#     where the source list calls it optional. `optional` there means "a
#     RELEASE need not contain this lane"; it never meant "this lane may
#     arrive half-built". The Android pair is one build - the ceremony
#     derives the APK from the AAB it just signed - so half of it is an
#     interrupted ceremony, never a smaller release.
#   * every row the named lanes do not claim is DROPPED, so an artifact
#     belonging to another lane is undeclared and hard-fails. A per-lane
#     manifest must not become a place where a stray file is laundered
#     into the release's trust root.
#
# The caller is responsible for recording the partial coverage in the
# signed manifest (xr_write_manifest's `lanes` argument). A partial
# manifest that did not say so would be precisely the defect the full
# gate exists to prevent, arriving from the other side: a record that
# verifies perfectly and describes a release nobody built.
#
# Args: lanes_file expected_file lane [lane ...]
xr_lane_scope() {
    local lanes="$1" expected="$2"
    shift 2
    local -a want=("$@")

    if [[ ${#want[@]} -eq 0 ]]; then
        echo "release/lib.sh: xr_lane_scope was given no lane names." >&2
        return 2
    fi
    if [[ ! -f "$lanes" ]]; then
        echo "release/lib.sh: shipped-lane list not found: $lanes" >&2
        echo "  It is where a lane's identity is declared, so without it there" >&2
        echo "  is no such thing as a lane to scope a release to." >&2
        return 1
    fi
    if [[ ! -f "$expected" ]]; then
        echo "release/lib.sh: expected-artifact list not found: $expected" >&2
        return 1
    fi

    local -a known=() scoped=() lane_globs=()
    local lane lstatus rest w

    while read -r lane lstatus rest || [[ -n "$lane" ]]; do
        case "$lane" in ''|'#'*) continue ;; esac

        # The same fail-shut parse as xr_check_shipped_lanes, for the same
        # reason: a typo in the status word must not reach a permissive
        # branch, and here it would also decide which artifacts a signed
        # manifest demands.
        if [[ "$lstatus" != "SHIPPED" && "$lstatus" != "NOT-SHIPPED" ]]; then
            echo "release/lib.sh: $lanes: lane '$lane' declares status" \
                 "'${lstatus:-<missing>}'; expected SHIPPED or NOT-SHIPPED." >&2
            return 1
        fi
        known+=("$lane")

        for w in "${want[@]}"; do
            [[ "$w" == "$lane" ]] || continue
            if [[ -z "$rest" ]]; then
                echo "release/lib.sh: $lanes: lane '$lane' declares no artifact glob." >&2
                return 1
            fi
            # `read -r -a` rather than `for p in $rest`: every word here IS
            # a glob, and an unquoted expansion would let the working
            # directory decide which of them survive.
            read -r -a lane_globs <<< "$rest"
            scoped+=("${lane_globs[@]}")
        done
    done < "$lanes"

    # An unknown lane name fails here rather than resolving to an empty
    # scope. An empty scope would demand nothing at all, which is the one
    # outcome this whole mechanism exists to make impossible.
    local found k
    for w in "${want[@]}"; do
        found=0
        for k in "${known[@]:-}"; do
            [[ "$w" == "$k" ]] && { found=1; break; }
        done
        if [[ "$found" -eq 0 ]]; then
            echo "release/lib.sh: '$w' is not a lane declared in $lanes." >&2
            echo "  Declared lanes: ${known[*]:-<none>}" >&2
            echo "  A lane name decides which artifacts the gate demands, so a" >&2
            echo "  typo fails here instead of narrowing the release to nothing." >&2
            return 1
        fi
    done

    if [[ ${#scoped[@]} -eq 0 ]]; then
        echo "release/lib.sh: the requested lane(s) claim no artifact globs: ${want[*]}" >&2
        return 1
    fi

    # THE ROW IS COPIED, NOT REBUILT, and that is load-bearing. An earlier
    # version parsed four columns and re-emitted them, which silently
    # dropped the fifth (the signature class, ) - so a scoped release
    # reached verify-signatures.mjs with every artifact declaring no class
    # at all. That is this file's own recurring defect, a gate that cannot
    # fail on a column it was never told about, committed by the very
    # function meant to preserve the gate's power. Everything after the
    # status word travels verbatim, including whatever column is added
    # next; only the strength is rewritten, and `optional` and `required`
    # are the same width so the alignment survives too.
    local -a rows=()
    local line status tail_ trimmed pattern p
    while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in ''|'#'*|[[:space:]]*) continue ;; esac
        status="${line%%[[:space:]]*}"
        tail_="${line#"$status"}"
        case "$status" in
            required|optional) ;;
            *)
                echo "release/lib.sh: $expected: unknown status '$status'" \
                     "(expected 'required' or 'optional')" >&2
                return 1
                ;;
        esac
        trimmed="${tail_#"${tail_%%[![:space:]]*}"}"
        pattern="${trimmed%%[[:space:]]*}"
        for p in "${scoped[@]}"; do
            if [[ "$pattern" == "$p" ]]; then
                rows+=("required$tail_")
                break
            fi
        done
    done < "$expected"

    # Drift, the same direction xr_check_shipped_lanes guards: a lane that
    # claims a glob no release row declares would put the two files on
    # different releases, and here it would silently shrink the scope.
    local matched r r_pattern r_tail r_trimmed
    for p in "${scoped[@]}"; do
        matched=0
        for r in "${rows[@]:-}"; do
            r_tail="${r#required}"
            r_trimmed="${r_tail#"${r_tail%%[![:space:]]*}"}"
            r_pattern="${r_trimmed%%[[:space:]]*}"
            [[ "$r_pattern" == "$p" ]] && { matched=1; break; }
        done
        if [[ "$matched" -eq 0 ]]; then
            echo "release/lib.sh: $lanes claims glob '$p', which no row of" \
                 "$expected declares." >&2
            echo "  The two files would be describing different releases, and a" >&2
            echo "  scope built from them would demand less than either." >&2
            return 1
        fi
    done

    printf '%s\n' \
        "# GENERATED by xr_lane_scope. Do not edit and do not commit: this is a" \
        "# PARTIAL release scope, derived per-run from the two committed lists." \
        "#" \
        "#   lanes:    ${want[*]}" \
        "#   from:     $expected" \
        "#   and:      $lanes" \
        "#" \
        "# Every row is 'required' even where the source list says optional: a" \
        "# lane is optional to a RELEASE, never to itself. Rows belonging to any" \
        "# other lane are absent, so their artifacts read as undeclared here." \
        "" \
        "${rows[@]}"
}
