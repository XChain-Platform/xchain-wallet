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
# Manifest format (§6 hardening):
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
# Version 2 added the profile lines. A build profile is which
# SET OF FEATURES was compiled in, and v1 has exactly two: `default`
# (web, desktop, extension) and `store` (the mobile store builds, which
# compile OUT the surfaces the app-store review posture hides, per
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
# something and returning success. A sourced-only file is still a
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
# "is this file a channel pointer" (§7.1). Resolved from this
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

# The build profiles a release may contain (rails §3 owns the
# list). Adding a third is a spec change, not an implementation choice,
# because every reader of a manifest has to know what the name means.
XR_PROFILES=(default store)

# The RELEASE SETS a declaration row can belong to (§7.5).
#
# A row's `status` column says both whether the artifact is demanded AND
# which set demands it. `required`/`optional` describe a PRODUCTION
# release; `staging-<os>-required`/`staging-<os>-optional` describe the §7.5
# rehearsal set, which by design holds only the update-capable formats
# (mac zip, win nsis, linux AppImage + deb) and therefore can never
# satisfy the production rows.
#
# WHY THIS IS A SET AND NOT A PROFILE. The obvious move is to reuse the
# profile column, and it does not work: `xr_profile_for` scans every row
# for a name match and refuses when one filename matches two globs
# declaring DIFFERENT profiles, because then "the list cannot say what it
# was built with". A staging AppImage is built by the `default` profile -
# the same code with a different feed baked in - so that column is
# already telling the truth about it and must not be overloaded to mean a
# second thing. Splitting on status keeps ONE file, keeps both shapes
# visible side by side, and leaves `xr_profile_for` correct with no
# change at all: the duplicate globs declare the SAME profile, which is
# not an ambiguity.
XR_SETS=(release staging)

# The OSes a staging row can name. A rehearsal is per-OS by §7.5's own
# words - "on the arches being rehearsed", "at least one OS" - and until
# 2026-08-07 the gate demanded every staging row at once, so a Linux-only
# rehearsal failed on the mac and windows rows and could only ever run once
# the Apple and Azure credentials existed. Those credentials are what the
# rehearsal is meant to de-risk, so the rule made the rehearsal wait on its
# own purpose. Operator answer that day: scope it per OS, properly.
XR_STAGING_OSES=(linux mac windows)

# The update channel a lane's users actually receive versions through,
# declared per lane in shipped-lanes.txt (dq-11 answer 2026-08-11).
#
# `store-only` is every lane that ships through a store: Play, the App
# Stores, Snap, Chrome. The store IS their update channel, so a release
# covering only such lanes carries no electron-updater pointer and has no
# desktop update path to rehearse - which is why publish.sh waives both
# checks for them.
#
# `updater` is the three desktop lanes, whose users update through OUR
# feed: a channel pointer we publish, walked by electron-updater, proven
# on real hardware by the §7.5 rehearsal. Keying those waivers on "is this
# release partial" was safe only while every partial release was a store
# release. The moment a partial DESKTOP release became cuttable, that
# inference would have published to real users with the rehearsal gate
# silently skipped, so the question publish.sh asks is now this column
# rather than the shape of the directory.
XR_LANE_FEEDS=(updater store-only)

# Echo the release set a status token belongs to, or nothing if the token
# is not a status at all. The empty answer is what makes an unknown
# status a hard failure at the call site rather than a silently skipped
# row - the failure mode this whole file exists to refuse.
xr_set_for_status() {
    case "$1" in
        required|optional) echo release ;;
        staging-linux-required|staging-linux-optional) echo staging ;;
        staging-mac-required|staging-mac-optional) echo staging ;;
        staging-windows-required|staging-windows-optional) echo staging ;;
        *) echo "" ;;
    esac
}

# Echo the OS a staging status token names, or nothing for a production
# token. Deliberately enumerated rather than pattern-matched out of the
# string: a `staging-macos-required` typo must reach the unknown-status
# refusal in xr_check_expected, not quietly create a fourth OS that no
# rehearsal will ever ask for and no gate will ever miss.
xr_os_for_status() {
    case "$1" in
        staging-linux-required|staging-linux-optional) echo linux ;;
        staging-mac-required|staging-mac-optional) echo mac ;;
        staging-windows-required|staging-windows-optional) echo windows ;;
        *) echo "" ;;
    esac
}

# True if $1 is a declared rehearsal OS.
xr_is_staging_os() {
    local candidate="$1" o
    for o in "${XR_STAGING_OSES[@]}"; do
        [[ "$candidate" == "$o" ]] && return 0
    done
    return 1
}

# True if an OS is inside a rehearsal's declared scope (dq-13). The scope is
# a list, so this is membership rather than equality; an EMPTY scope matches
# nothing, deliberately - "no OS was named" must never read as "every OS is
# in scope" inside a gate whose whole job is to demand artifacts.
xr_os_in_scope() {
    local candidate="$1" o
    shift
    for o in "$@"; do
        [[ "$candidate" == "$o" ]] && return 0
    done
    return 1
}

# True if a status token DEMANDS its artifact, as opposed to allowing it.
xr_status_is_required() {
    case "$1" in
        required|staging-*-required) return 0 ;;
        *)                           return 1 ;;
    esac
}

# True if $1 is a declared release set.
xr_is_set() {
    local candidate="$1" s
    for s in "${XR_SETS[@]}"; do
        [[ "$candidate" == "$s" ]] && return 0
    done
    return 1
}

# True if $1 is a declared profile name.
xr_is_profile() {
    local candidate="$1" p
    for p in "${XR_PROFILES[@]}"; do
        [[ "$candidate" == "$p" ]] && return 0
    done
    return 1
}

# True if $1 is a declared lane-feed name.
xr_is_lane_feed() {
    local candidate="$1" f
    for f in "${XR_LANE_FEEDS[@]}"; do
        [[ "$candidate" == "$f" ]] && return 0
    done
    return 1
}

# True if ANY of the named lanes updates through our own feed.
#
# Deliberately ANY rather than ALL: a release covering one updater lane
# and three store lanes still publishes a channel pointer that real
# installs will fetch, so it still needs the pointer assertion and the
# §7.5 rehearsal. ALL would waive both the moment a store lane joined a
# desktop release, which is the same silent-waiver shape this column
# exists to end.
#
# Fails SHUT on an unreadable list (return 0, "treat as updater"): the
# consequence of a false positive is a rehearsal being demanded of a
# release that did not need one, and of a false negative is a desktop
# release published unrehearsed.
xr_lanes_have_updater_feed() {
    local lanes="$1"
    shift
    local -a want=("$@")
    local lane lstatus feed rest w

    if [[ ! -f "$lanes" ]] || [[ ${#want[@]} -eq 0 ]]; then
        return 0
    fi

    while read -r lane lstatus feed rest || [[ -n "$lane" ]]; do
        case "$lane" in ''|'#'*) continue ;; esac
        for w in "${want[@]}"; do
            [[ "$w" == "$lane" ]] || continue
            [[ "$feed" == "updater" ]] && return 0
        done
    done < "$lanes"

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
# (§2.3), so writing `store` into a
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
        echo "  build does not actually have. See §2.3." >&2
        return 1
    fi
}

# Write "$dir/RELEASE_HASHES.txt" with the signed header + sorted hashes.
# Args: dir tag tag_commit built_utc dev_mock_gate_state [expected_file] [lanes]
#
# `lanes` is set only for a PARTIAL release (sign.sh --lane) and
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
    local lanes="${7:-}" staging_os="${8:-}" signing="${9:-}"
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
        # A SCOPED REHEARSAL SAYS SO, in its own field rather than in the
        # `lanes` one (§7.5, operator answer 2026-08-07). Two reasons, and
        # the second is the load-bearing one. A reader of a staging manifest
        # must be told which OS was rehearsed instead of inferring it from
        # which files happen to be listed. And `publish.sh` refuses any
        # manifest carrying `# lanes:` on the staging path, deliberately -
        # reusing that field to mean "one OS" would have made a correctly
        # scoped rehearsal unpublishable, which is the shape that blocked
        # this for a day. Coverage stays whole WITHIN the OS it names, so
        # this is not `coverage: partial`.
        if [[ -n "$staging_os" ]]; then
            # Normalised to space-separated, matching `# lanes:` above, so
            # the scope reads the same whichever way it was typed (dq-13).
            echo "# rehearsal-os: $(echo "$staging_os" | tr ',' ' ' | tr -s ' ')"
        fi
        # AN UNATTENDED SIGNATURE SAYS SO, IN THE THING IT SIGNS.
        #
        # `dq-9` originally kept a human at the pinentry for production and
        # allowed a passphrase file for rehearsals only; the operator amended
        # it on 2026-08-10 to permit an unattended production signature
        # behind an explicit `--unattended`. What that amendment costs is the
        # property the original ruling was protecting: that a K1 signature on
        # a production manifest meant a person chose to make it. That cost
        # cannot be undone, but it CAN be made visible, and a reader deciding
        # how much a signature is worth is exactly who needs to know.
        #
        # So the manifest declares its own provenance. Emitted ONLY on the
        # unattended path, so every attended manifest stays byte-identical to
        # the ones already published and no verifier sees a new field where
        # nothing changed. A `#` line is ignored by `sha256sum -c` like every
        # other header here.
        if [[ -n "$signing" ]]; then
            echo "# signing: $signing"
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
# This is the read side of the profile field and needs no repo: the claim is inside
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
        echo "  feature set each artifact was built with (manifest-version 2)." >&2
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

# Which RELEASE a tag names, with any re-sign suffix stripped.
#
# A re-sign tag is `<release tag>-resign<N>`: the release tag's tree with
# the release TOOLING corrected and nothing else, cut so that a manifest
# can be signed by a gate that really runs. `tools/release/prepare-resign-tag.sh`
# is the only thing that makes one, and it refuses any name whose X.Y.Z
# core differs from the release it re-signs.
#
# It exists because signing reads TWO trees. The scripts come from the
# invoking checkout; `check-no-dev-mock.sh`, `shipped-lanes.txt` and
# `expected-artifacts.txt` come from `--repo`, the tree at the tag. So a
# defect fixed in the gate cannot reach a release already tagged, and the
# published v0.336.0 manifest says `dev-mock-gate: enforced` for a gate
# that read zero bytes. Correcting that record means re-signing from a
# NEW tag, and the corrected manifest is then republished under the
# release's own name - `RELEASE_HASHES/v0.336.0.txt`, the name every
# existing link and every reader already has.
#
# So the anchor check has to know that `v0.336.0-resign1` describes
# `v0.336.0` while still refusing a manifest from any OTHER release,
# which is the only thing that check has ever been for. The relation is
# ONE-WAY at the call site: a re-signature satisfies a request for the
# release, and the superseded original does NOT satisfy a request for the
# re-signature.
# Args: tag
xr_release_tag_of() {
    printf '%s\n' "$1" | sed -E 's/-resign[0-9]+$//'
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
# shipped matrix is x64 + arm64 (§2) and the other two are here so
# that the day DD1 adds armv7l, or DD3 flips macOS to a universal binary,
# the change is one column rather than a code change.
#
# `multi` is not an architecture. It names an artifact that carries MORE
# THAN ONE arch and therefore belongs to no lane - electron-builder's
# combined NSIS installer is the only one we have seen. It is an
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
# same class of event as the combined NSIS installer reappearing.
# Inferring x64 would wave that through; refusing to
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

# Echo the architecture an ELF file's own header declares, or nothing if
# the file is not an ELF at all.
#
# WHY A HEADER READ AND NOT `file`: this runs on the release host and on a
# developer's Mac, `file`'s wording differs between them, and parsing prose
# to decide whether a release ships is the kind of dependency that breaks on
# an OS upgrade. The two bytes at 0x12 are e_machine and they are the same
# two bytes everywhere.
#
# The pair is read one byte at a time and reassembled little-endian, rather
# than with `od -tx2`, because -tx2 prints in HOST byte order and would read
# every value backwards on a big-endian builder.
xr_elf_machine() {
    local f="$1" magic bytes value
    [[ -f "$f" ]] || { echo ""; return 0; }
    magic="$(od -An -tx1 -N4 "$f" 2>/dev/null | tr -d ' \n')"
    [[ "$magic" == "7f454c46" ]] || { echo ""; return 0; }
    bytes="$(od -An -tx1 -j18 -N2 "$f" 2>/dev/null | tr -d ' \n')"
    value="${bytes:2:2}${bytes:0:2}"
    case "$value" in
        003e) echo x64 ;;
        00b7) echo arm64 ;;
        0028) echo armv7l ;;
        0003) echo ia32 ;;
        *) echo "unknown-e_machine-0x${value}" ;;
    esac
}

# The Debian multiarch triplet directory each architecture's libraries live
# in. A payload built for one arch and filled with another's libraries says
# so in its own paths, which is the cheapest true signal available without
# unpacking 120MB of squashfs.
xr_arch_triplet() {
    case "$1" in
        x64) echo x86_64-linux-gnu ;;
        arm64) echo aarch64-linux-gnu ;;
        armv7l) echo arm-linux-gnueabihf ;;
        ia32) echo i386-linux-gnu ;;
        *) echo "" ;;
    esac
}

# Does what an artifact CONTAINS agree with what its name CLAIMS?
#
# THE GATE USED TO ANSWER THIS FROM THE FILENAME ALONE, and on 2026-08-06 a
# probe showed what that misses: snapcraft packed x86-64 libraries into a
# snap whose own meta/snap.yaml declared `architectures: [arm64]`, exit 0,
# no warning. Filename, metadata and payload all have to agree,
# and only the payload is the thing a user's machine has to execute. An
# arm64-labelled artifact full of x86-64 code installs, passes every hash
# and signature check we have, and cannot start.
#
# A MISSING EXTRACTOR IS A PROBLEM, NOT A SKIP. This gate decides whether a
# release ships; a check that quietly becomes a no-op on the one host where
# it was needed is the "mechanism nothing ran" family this lane keeps
# rediscovering. It names the tool and the artifact rather than shrugging.
#
# Args: dir name declared-arch. Prints problems on stderr, count on stdout.
xr_check_payload_arch() {
    local dir="$1" name="$2" arch="$3"
    local f="$dir/${name#./}" problems=0 triplet machine listing="" n

    triplet="$(xr_arch_triplet "$arch")"
    [[ -n "$triplet" ]] || { echo 0; return 0; }

    case "${name#./}" in
        *.AppImage)
            # An AppImage IS an ELF: its runtime is the executable a user
            # runs, so its own header is the definitive answer and needs no
            # extractor at all.
            machine="$(xr_elf_machine "$f")"
            if [[ -n "$machine" && "$machine" != "$arch" ]]; then
                echo "PAYLOAD-ARCH  '${name#./}' is named $arch and its ELF header says" >&2
                echo "              $machine. The file a user executes is the one that" >&2
                echo "              decides, and it disagrees with the name the feed" >&2
                echo "              publishes it under." >&2
                problems=$((problems + 1))
            elif [[ -z "$machine" ]]; then
                echo "PAYLOAD-ARCH  '${name#./}' does not start with an ELF magic, so it is" >&2
                echo "              not the self-executing image an AppImage must be." >&2
                problems=$((problems + 1))
            fi
            ;;
        *.snap)
            if ! command -v unsquashfs >/dev/null 2>&1; then
                # NOT a failure, and the reason is where signing happens.
                # sign.sh runs on the RELEASE MACHINE, never in CI (§8: a
                # runner that could sign the manifest would make the manifest
                # worth exactly as much as the runner), and that machine is a
                # Mac with no squashfs-tools. Refusing here would block the
                # one path the release depends on to enforce a check the
                # operator can install in one command. So it says out loud
                # what it did not check, by name.
                echo "PAYLOAD-ARCH-UNCHECKED  '${name#./}' was NOT checked: unsquashfs is not on" >&2
                echo "              this host, and a snap's declared architecture is not" >&2
                echo "              evidence of its contents. Install it" >&2
                echo "              (brew install squashfs / apt install squashfs-tools) to" >&2
                echo "              have this artifact checked." >&2
            elif ! listing="$(unsquashfs -l "$f" 2>/dev/null)"; then
                echo "PAYLOAD-ARCH  '${name#./}' could not be read as a squashfs image by" >&2
                echo "              unsquashfs. An artifact whose contents cannot be read is" >&2
                echo "              not an artifact whose contents have been checked." >&2
                problems=$((problems + 1))
                listing=""
            fi
            ;;
        *.deb)
            if ! command -v dpkg-deb >/dev/null 2>&1; then
                # Same reasoning as the snap branch above.
                echo "PAYLOAD-ARCH-UNCHECKED  '${name#./}' was NOT checked: dpkg-deb is not on" >&2
                echo "              this host, so nothing has confirmed its contents match the" >&2
                echo "              architecture its name claims. Install it (brew install" >&2
                echo "              dpkg / apt install dpkg) to have this artifact checked." >&2
            elif ! listing="$(dpkg-deb -c "$f" 2>/dev/null)"; then
                echo "PAYLOAD-ARCH  '${name#./}' could not be read as a Debian package by" >&2
                echo "              dpkg-deb. An artifact whose contents cannot be read is" >&2
                echo "              not an artifact whose contents have been checked." >&2
                problems=$((problems + 1))
                listing=""
            else
                local declared
                declared="$(dpkg-deb -f "$f" Architecture 2>/dev/null || true)"
                case "$declared" in
                    amd64) declared=x64 ;;
                    arm64) declared=arm64 ;;
                    armhf) declared=armv7l ;;
                    i386) declared=ia32 ;;
                esac
                if [[ -n "$declared" && "$declared" != "$arch" ]]; then
                    echo "PAYLOAD-ARCH  '${name#./}' is named $arch and its own control file" >&2
                    echo "              declares $declared." >&2
                    problems=$((problems + 1))
                fi
            fi
            ;;
    esac

    # One listing, every foreign triplet.
    if [[ -n "$listing" ]]; then
        n="$(xr_check_foreign_triplets "$listing" "$arch" "${name#./}")"
        problems=$((problems + n))
    fi

    echo "$problems"
}

# Scan a package's FILE LISTING for another architecture's library
# directory. A payload carrying `x86_64-linux-gnu/` is carrying x86-64 code,
# whatever its label says, and this is the check that caught an
# arm64-labelled snap carrying x86-64 code (180 such paths).
#
# It takes the listing as text rather than opening the package itself, so it
# can be driven without unsquashfs, dpkg-deb, or a 120MB fixture. That is not
# a convenience: the version of this that lived inside the extractor branches
# could only ever be tested on a host that had them, which is the same shape
# as a check that quietly does not run.
#
# Args: listing arch artifact-name. Problems on stderr, count on stdout.
xr_check_foreign_triplets() {
    local listing="$1" arch="$2" name="$3"
    local triplet foreign found problems=0

    triplet="$(xr_arch_triplet "$arch")"
    [[ -n "$triplet" ]] || { echo 0; return 0; }

    for foreign in x86_64-linux-gnu aarch64-linux-gnu arm-linux-gnueabihf i386-linux-gnu; do
        [[ "$foreign" == "$triplet" ]] && continue
        found="$(printf '%s\n' "$listing" | grep -c "/${foreign}/" || true)"
        if [[ "${found:-0}" -gt 0 ]]; then
            echo "PAYLOAD-ARCH  '$name' is named $arch and carries $found path(s) under" >&2
            echo "              $foreign, which is another architecture's library" >&2
            echo "              directory. snapcraft will cross-build a package like this" >&2
            echo "              and exit 0; the machine that installs it" >&2
            echo "              cannot run it." >&2
            problems=$((problems + 1))
        fi
    done

    echo "$problems"
}

# Does a Linux artifact's payload carry the compiled native addon that a
# Linux install of this app produces?
#
# MEASURED ON REAL ARTIFACTS, NOT REASONED. The §7.5 rehearsal
# `.deb` built on the release Mac parses to 93 payload entries with zero
# `.node` files in them; a CI artifact for the same app carries 188
# and includes
# `resources/app.asar.unpacked/node_modules/tiny-secp256k1/build/Release/secp256k1.node`.
# The rehearsal therefore rehearses a bundle no release ever publishes, which
# is the one thing a rehearsal must not do.
#
# THE DIVERGENCE SHIPS IN SILENCE, which is why a gate has to ask.
# tiny-secp256k1@1.1.7's index.js is `try { require('./native') } catch
# { require('./js') }`, so a payload with no addon quietly runs that
# package's JS fallback: the build exits 0, the app starts, and nothing
# anywhere names the difference. Only the payload itself can answer.
#
# Args: dir name. Prints problems on stderr, count on stdout.
xr_check_payload_native() {
    local dir="$1" name="$2"
    local f="$dir/${name#./}" problems=0 listing="" tmp="" data="" cand offset found

    case "${name#./}" in
        *.snap)
            # A snap is a BARE squashfs image: no ELF runtime in front of it,
            # so unlike the AppImage branch there is no offset to find and the
            # extractor reads the file as given. It carries the same
            # `resources/app.asar.unpacked/` tree the `.deb` does, which is
            # what lets the shared tail below ask both the same question.
            #
            # It is in scope because the snap is built where the divergence
            # this gate exists to catch actually happens: snapcraft cannot run
            # in the pinned container, so the snap lane builds on the runner
            # (see the desktop-linux job), and a runner that never compiled
            # the addon produces a snap that starts, installs, verifies
            # against the signed manifest and silently runs tiny-secp256k1's
            # JS fallback.
            if ! command -v unsquashfs >/dev/null 2>&1; then
                # A missing extractor is a fact about this host, not about the
                # artifact, and refusing here would block the signing path
                # itself over a check that is one package away. Name what went
                # unchecked; what must not happen is silence.
                echo "PAYLOAD-NATIVE-UNCHECKED  '${name#./}' was NOT checked: unsquashfs is" >&2
                echo "              not on this host, and a snap's payload is a squashfs" >&2
                echo "              image nothing else here can read. Install it" >&2
                echo "              (brew install squashfs / apt install squashfs-tools) to" >&2
                echo "              have this artifact checked." >&2
                echo 0
                return 0
            fi
            # With the extractor present the verdict is the artifact's, not
            # the host's: a snap is squashfs at byte 0, so bytes that will not
            # list are bytes that are not a snap. That is the `.deb` branch's
            # posture, and it is deliberately NOT the AppImage branch's -
            # there the offset is a search that can legitimately come up
            # empty, here there is nothing to search for.
            listing="$(unsquashfs -l "$f" 2>/dev/null || true)"
            if [[ -z "$listing" ]]; then
                echo "PAYLOAD-NATIVE  '${name#./}' could not be read as a squashfs image," >&2
                echo "              though unsquashfs is installed here, so nothing has read" >&2
                echo "              its payload. A snap is squashfs at byte 0; bytes that" >&2
                echo "              will not list are not a snap." >&2
                problems=$((problems + 1))
            fi
            ;;
        *.deb)
            # `tar`, not `dpkg-deb`, because of where signing happens: sign.sh
            # runs on the RELEASE MACHINE (§8), a Mac with no dpkg at all, and
            # macOS tar is libarchive, which reads a `.deb`'s ar container
            # directly. A check enforceable only on the host that does not
            # sign is the "mechanism nothing ran" family this lane keeps
            # rediscovering.
            tmp="$(mktemp -d "${TMPDIR:-/tmp}/xr-native.XXXXXX")"
            if tar -x -f "$f" -C "$tmp" >/dev/null 2>&1; then
                for cand in "$tmp"/data.tar.*; do
                    if [[ -f "$cand" ]]; then data="$cand"; fi
                done
                if [[ -n "$data" ]]; then
                    listing="$(tar -t -f "$data" 2>/dev/null || true)"
                fi
            elif command -v dpkg-deb >/dev/null 2>&1; then
                # GNU tar does not read an ar archive, so a Linux venue needs
                # the other reader. Not a substitute for the branch above: the
                # signing host has only that one.
                listing="$(dpkg-deb -c "$f" 2>/dev/null || true)"
            fi
            if [[ -z "$listing" ]]; then
                # TWO SITUATIONS, and conflating them is what the Linux venue
                # caught: bytes that are not a Debian package at all, and a
                # real package no reader on this host can open. GNU tar does
                # not read an ar container, so a Linux box without dpkg-deb
                # has neither reader and was refusing good artifacts. The ar
                # magic separates them, which keeps a refusal a statement
                # about the ARTIFACT rather than about the host.
                if [[ "$(head -c 7 "$f" 2>/dev/null)" != "!<arch>" ]]; then
                    echo "PAYLOAD-NATIVE  '${name#./}' does not begin with an ar magic, so it is" >&2
                    echo "              not the Debian package its name claims to be." >&2
                    problems=$((problems + 1))
                else
                    # Same posture as the AppImage branch and as the arch
                    # gate's own dpkg-deb case: a missing extractor is a fact
                    # about the host, and refusing on it would block the one
                    # path a release depends on.
                    echo "PAYLOAD-NATIVE-UNCHECKED  '${name#./}' was NOT checked: no reader on" >&2
                    echo "              this host can open an ar container (GNU tar cannot, and" >&2
                    echo "              dpkg-deb is absent). Install dpkg to have it checked." >&2
                fi
            fi
            rm -rf "$tmp"
            ;;
        *.AppImage)
            if ! command -v unsquashfs >/dev/null 2>&1; then
                # NOT a failure, for the reason the *.snap branch above gives
                # at length: the release Mac has no squashfs-tools, and
                # refusing here would block the only path a release has in
                # order to enforce a check that is one brew command away. It
                # names what it did not check instead of going quiet.
                echo "PAYLOAD-NATIVE-UNCHECKED  '${name#./}' was NOT checked: unsquashfs is" >&2
                echo "              not on this host, and an AppImage's payload is a squashfs" >&2
                echo "              image nothing else here can read. Install it" >&2
                echo "              (brew install squashfs / apt install squashfs-tools) to" >&2
                echo "              have this artifact checked." >&2
                echo 0
                return 0
            fi
            # An AppImage is an ELF runtime with the squashfs appended, so the
            # extractor needs the offset that image starts at, and 'hsqs' is
            # the image's own magic.
            #
            # THE MAGIC OCCURS MORE THAN ONCE AND THE FIRST ONE IS NOT THE
            # IMAGE. This took the first textual match, and the first real
            # AppImage ever put through it proved that wrong: on the v0.336.0
            # x86_64 build, 'hsqs' appears at byte 32609 inside the ELF
            # runtime and the actual superblock is at 188392. unsquashfs at
            # 32609 lists nothing, so the branch fell through to UNCHECKED and
            # returned 0 - meaning this gate has never once read an AppImage,
            # and it failed in the one way nothing notices, by declining to
            # judge rather than by judging wrong (frontier row 132).
            #
            # Try the candidates in order and keep the first that actually
            # lists. The extractor reading the image is the only honest test of
            # where the image is; a magic string is a guess at it. Bounded at
            # 32 candidates so a pathological file cannot turn a release gate
            # into a full-file rescan loop.
            listing=""
            while IFS= read -r offset; do
                [[ -n "$offset" ]] || continue
                if listing="$(unsquashfs -o "$offset" -l "$f" 2>/dev/null)" && [[ -n "$listing" ]]; then
                    break
                fi
                listing=""
            done < <(grep -a -b -o hsqs "$f" 2>/dev/null | cut -d: -f1 | head -32)
            if [[ -z "$listing" ]]; then
                echo "PAYLOAD-NATIVE-UNCHECKED  '${name#./}' was NOT checked: its squashfs" >&2
                echo "              image could not be located or listed here. The .deb in the" >&2
                echo "              same set carries the same payload and IS checked, so" >&2
                echo "              refusing would fail a release over this check's own" >&2
                echo "              limitation rather than over the artifact." >&2
                echo 0
                return 0
            fi
            ;;
        *)
            # Every other format is out of scope. A measured probe found the Linux
            # lane's divergence; what a .dmg or an .exe ought to carry is a
            # rule nobody has driven, and guessing it here would gate a
            # release on an assumption.
            echo 0
            return 0
            ;;
    esac

    # One listing, one question: is a compiled addon in the unpacked tree?
    if [[ -n "$listing" ]]; then
        found="$(printf '%s\n' "$listing" | grep -c 'resources/app\.asar\.unpacked/.*\.node' || true)"
        if [[ "${found:-0}" -eq 0 ]]; then
            echo "PAYLOAD-NATIVE  '${name#./}' carries no compiled addon: nothing under" >&2
            echo "              resources/app.asar.unpacked/ ends in .node. A Linux install" >&2
            echo "              compiles tiny-secp256k1 and the release lane's own artifact" >&2
            echo "              ships secp256k1.node, so a payload without one" >&2
            echo "              was built where that addon never compiled and is running" >&2
            echo "              the package's JS fallback." >&2
            problems=$((problems + 1))
        fi
    fi

    echo "$problems"
}

# Run the payload checks over every Linux artifact in a directory.
#
# Deliberately NOT folded into xr_check_expected. That function answers "is
# the set complete and correctly named", which it can do against placeholder
# files; this one has to open the bytes, so it is a different question asked
# of a different thing, and keeping them apart is what lets each be driven
# honestly. sign.sh calls both, in that order, before it signs anything.
xr_check_payload_arches() {
    local dir="$1" name arch problems=0 native=0 n

    while IFS= read -r name; do
        [[ -z "$name" ]] && continue
        case "${name#./}" in
            *.AppImage|*.snap|*.deb) ;;
            *) continue ;;
        esac
        # The same set answers a second question, and the §7.5 rehearsal got
        # it wrong: does the payload carry the addon a Linux
        # install compiles? Tallied apart from the arch count so each gate
        # reports the defect it actually found.
        #
        # ASKED FIRST, BECAUSE IT NEEDS NO ARCH AND WAS BEING SKIPPED AS
        # THOUGH IT DID. The `continue` below is written for the arch check
        # and silently took this one with it, so a Linux package that lost
        # its arch suffix passed BOTH payload gates without a word - the
        # artifact shape most likely to have been renamed or hand-assembled,
        # checked least. Nobody chose that; it fell out of the ordering.
        n="$(xr_check_payload_native "$dir" "$name")"
        native=$((native + n))
        arch="$(xr_artifact_arch "$name")"
        # An unattributable name is xr_check_expected's finding to report,
        # not this one's; reporting it twice would double-count one defect.
        [[ -n "$arch" ]] || continue
        n="$(xr_check_payload_arch "$dir" "$name" "$arch")"
        problems=$((problems + n))
    done < <(xr_list_artifacts "$dir")

    if [[ "$problems" -gt 0 ]]; then
        echo >&2
        echo "release/lib.sh: payload-architecture gate FAILED ($problems problem(s))." >&2
        echo "  An artifact's name, its metadata and its contents all have to" >&2
        echo "  agree. Publishing one that does not gives a user a download that" >&2
        echo "  installs, verifies against the signed manifest, and cannot run." >&2
    fi

    if [[ "$native" -gt 0 ]]; then
        echo >&2
        echo "release/lib.sh: payload-native gate FAILED ($native problem(s))." >&2
        echo "  A Linux payload with no compiled addon was built where that" >&2
        echo "  addon never compiled, and tiny-secp256k1 falls back to JS with" >&2
        echo "  nothing said. Build the set the release lane builds" >&2
        echo "  it in, rather than publishing a rehearsal of a different bundle." >&2
    fi

    if [[ "$problems" -gt 0 || "$native" -gt 0 ]]; then
        return 1
    fi

    echo "release/lib.sh: payload-architecture gate ok." >&2
    echo "release/lib.sh: payload-native gate ok." >&2
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
            echo "              (combined-installer arch row). Decide it rather than" >&2
            echo "              ship it: stop emitting" >&2
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
            echo "              (§8). That release leaves every $a install with no" >&2
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
# 2026-08-01 (§8). The globs are extension-shaped on purpose, so
# `*.dmg` is satisfied by ONE dmg: a release that built x64 and silently
# dropped arm64 - which is exactly what the `--` argv bug did to all six
# lanes - passed this gate with a clean manifest. The arch column closes
# it, and catches the opposite defect too: an artifact that belongs to no
# architecture at all.
#
# Args: dir expected_file [release_set] [staging_os]
#
# staging_os narrows a `staging` run to the rows naming that OS (§7.5,
# operator answer 2026-08-07). Empty means the whole rehearsal set, which
# is what a full release cuts. It is meaningless on a production run and
# refused there rather than ignored: a caller that passes one is confused
# about which gate it is running, and silently dropping it would gate a
# production release against the full list while its operator believed it
# had scoped the run.
#
# release_set defaults to `release`, so every existing caller keeps its
# exact behaviour: rows belonging to another set are skipped entirely,
# which means they contribute no required pattern, no arch requirement,
# and - importantly - no allowance to the UNDECLARED sweep below. A
# staging artifact staged into a production directory is still undeclared
# there, and vice versa. That is the point of a set rather than a widened
# list: it must be impossible for a rehearsal artifact to satisfy a
# production row, or the gate would let a staging binary be signed and
# published as the real one (§7.5's byte-different-twins hazard).
xr_check_expected() {
    local dir="$1" expected="$2" want_set="${3:-release}" want_os="${4:-}"

    if [[ ! -f "$expected" ]]; then
        echo "release/lib.sh: expected-artifact list not found: $expected" >&2
        echo "  This list is what stops a partially-populated directory from" >&2
        echo "  producing a clean-looking manifest. It is not optional." >&2
        return 1
    fi

    if ! xr_is_set "$want_set"; then
        echo "release/lib.sh: unknown release set '$want_set'" \
             "(expected one of: ${XR_SETS[*]})" >&2
        return 1
    fi

    # The OS scope is a LIST (dq-13, operator 2026-08-11). A rehearsal used
    # to be scoped to exactly one OS, and each OS's rehearsal of one tag
    # signs a manifest that lands on the SAME RELEASE_HASHES/<tag>.txt on the
    # shared staging feed - so rehearsing mac after Linux overwrote the
    # manifest the Linux lanes verify against, and only one OS could be
    # rehearsed per tag. Naming the file per OS was the other candidate and
    # was rejected: that path is resolved by the SHIPPED updateVerify.js from
    # the bundle's own feed base and version, so it must not be varied for a
    # rehearsal-only reason. One signature over every rehearsed artifact.
    local -a want_oses=()
    if [[ -n "$want_os" ]]; then
        if [[ "$want_set" != staging ]]; then
            echo "release/lib.sh: OS scope '$want_os' given for release set" \
                 "'$want_set'; only a staging run is per-OS (§7.5)." >&2
            return 1
        fi
        local _o _dupes
        # Split on commas AND whitespace, so `--os mac,linux` and the same
        # scope read back out of a manifest header are one input shape.
        IFS=', ' read -r -a want_oses <<< "$want_os"
        if [[ ${#want_oses[@]} -eq 0 ]]; then
            echo "release/lib.sh: OS scope '$want_os' names no OS" >&2
            return 1
        fi
        for _o in "${want_oses[@]}"; do
            if ! xr_is_staging_os "$_o"; then
                echo "release/lib.sh: unknown rehearsal OS '$_o'" \
                     "(expected one of: ${XR_STAGING_OSES[*]})" >&2
                return 1
            fi
        done
        # A repeated OS would add its required rows to the tally twice,
        # which is a gate that is silently wrong rather than loudly wrong.
        _dupes="$(printf '%s\n' "${want_oses[@]}" | sort | uniq -d | tr '\n' ' ')"
        if [[ -n "${_dupes// /}" ]]; then
            echo "release/lib.sh: OS scope '$want_os' names ${_dupes}more than once" >&2
            return 1
        fi
    fi

    local -a req_pats=() opt_pats=() req_arch=() opt_arch=()
    local status pattern profile arches tok row_set
    local seen_rows=0
    # `|| [[ -n "$status" ]]` so a file with no trailing newline does not
    # silently drop its last row - which, in this file, would mean
    # silently dropping a required artifact.
    while read -r status pattern profile arches _rest || [[ -n "$status" ]]; do
        case "$status" in
            ''|'#'*) continue ;;
        esac
        row_set="$(xr_set_for_status "$status")"
        if [[ -z "$row_set" ]]; then
            echo "release/lib.sh: $expected: unknown status '$status'" \
                 "(expected required, optional, or staging-<os>-required" \
                 "/staging-<os>-optional for os in ${XR_STAGING_OSES[*]})" >&2
            return 1
        fi
        # Every row is VALIDATED (profile, arch tokens) whichever set it
        # belongs to, and only then filtered. Validating just the active
        # set would let a typo sit undetected in the staging rows through
        # every production release, and surface on the one day the
        # rehearsal runs - which is the release day.
        # The OS filter sits INSIDE the set filter and after validation, so
        # a scoped run still parses and refuses a bad row in an OS it is not
        # rehearsing - the same reason every row is validated whichever set
        # it belongs to. A row this run does not want contributes nothing:
        # not a requirement, and not an allowance to the UNDECLARED sweep,
        # so a stray Windows installer in a Linux rehearsal directory is
        # still undeclared rather than quietly permitted.
        if [[ "$row_set" == "$want_set" ]] \
           && { [[ -z "$want_os" ]] || xr_os_in_scope "$(xr_os_for_status "$status")" "${want_oses[@]}"; }; then
            seen_rows=$((seen_rows + 1))
            if xr_status_is_required "$status"; then
                req_pats+=("$pattern"); req_arch+=("$arches")
            else
                opt_pats+=("$pattern"); opt_arch+=("$arches")
            fi
        fi
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
        echo "release/lib.sh: $expected declares no required artifacts" \
             "for release set '$want_set'." >&2
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
        echo "  Checked against: $expected (release set '$want_set')" >&2
        echo "  Either the staging directory is wrong, or the list is stale." >&2
        echo "  If the artifact set genuinely changed, update the list in the" >&2
        echo "  same commit that changed it." >&2
        return 1
    fi

    # The leading parenthetical is kept EXACTLY as it was, and the set
    # detail appended after it, because release-arch-coverage.smoke.js
    # pins this line. A gate's success message is part of its contract
    # with the guard that watches it: breaking it to add nicer wording
    # would have meant editing the guard to accept whatever the gate now
    # says, which is the wrong direction of travel for a release check.
    echo "release/lib.sh: artifact-set gate ok (${#artifacts[@]} artifact(s))" \
         "[release set '$want_set', $seen_rows declared row(s)]." >&2
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
# The gap is real and it is the §8 shape one level up. Nothing
# about a first upload edits expected-artifacts.txt, so the release AFTER
# the first Android release could omit the Android pair and produce a
# manifest that is internally perfect while leaving every direct-APK
# install without the fix it was told to expect. §6 states the
# invariant ("never let the direct lane lag"); this is the mechanism.
#
# Fail-shut in both directions, because a gate that reads a stale or
# unclaimed declaration and shrugs is the gate that was already missing:
# an unknown status, a glob that no expected-artifacts row declares, and
# an `optional` row that no lane claims are all hard failures.
#
# A FOURTH ARGUMENT NARROWS IT TO A PARTIAL RELEASE. When a
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
            # The §7.5 rehearsal rows are deliberately NOT collected: this
            # function asks whether a lane that has SHIPPED is present in a
            # release, and a rehearsal set is not a release. Naming them
            # here rather than letting them fall through the `esac` keeps
            # the omission deliberate instead of accidental.
            staging-*-required|staging-*-optional) continue ;;
        esac
    done < "$expected"

    local -a artifacts=()
    local line
    while IFS= read -r line; do
        [[ -n "$line" ]] && artifacts+=("${line#./}")
    done < <(xr_list_artifacts "$dir")

    local failures=0 lane lstatus feed rest pat p name matched claimed
    local -a claimed_pats=()

    while read -r lane lstatus feed rest || [[ -n "$lane" ]]; do
        case "$lane" in ''|'#'*) continue ;; esac

        if [[ "$lstatus" != "SHIPPED" && "$lstatus" != "NOT-SHIPPED" ]]; then
            echo "release/lib.sh: $lanes: lane '$lane' declares status" \
                 "'${lstatus:-<missing>}'; expected SHIPPED or NOT-SHIPPED." >&2
            echo "  Not defaulted to the permissive one on purpose: a typo must" >&2
            echo "  not quietly disarm the parity requirement it was editing." >&2
            return 1
        fi
        if ! xr_is_lane_feed "$feed"; then
            echo "release/lib.sh: $lanes: lane '$lane' declares feed" \
                 "'${feed:-<missing>}'; expected ${XR_LANE_FEEDS[*]}." >&2
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
                echo "                 version nothing will ever update (§6)." >&2
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
# and print the restricted list on stdout.
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
    local lane lstatus feed rest w

    while read -r lane lstatus feed rest || [[ -n "$lane" ]]; do
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
        # Same argument one column over: the feed word decides whether
        # publish.sh demands a channel pointer and a §7.5 rehearsal of a
        # partial release, so an unreadable one must not reach the
        # permissive branch either.
        if ! xr_is_lane_feed "$feed"; then
            echo "release/lib.sh: $lanes: lane '$lane' declares feed" \
                 "'${feed:-<missing>}'; expected ${XR_LANE_FEEDS[*]}." >&2
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
    # dropped the fifth (the signature class) - so a scoped release
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
            # A lane scope is a PRODUCTION concept: it narrows a release
            # to the lanes whose artifacts are ready. The §7.5 rehearsal
            # rows describe a different set entirely, and sign.sh refuses
            # `--staging` together with `--lane` for that reason, so they
            # are skipped here rather than scoped or rejected. Skipping
            # is stated out loud because a silently dropped row is the
            # failure mode this file keeps being bitten by.
            staging-*-required|staging-*-optional) continue ;;
            *)
                echo "release/lib.sh: $expected: unknown status '$status'" \
                     "(expected required, optional, or staging-<os>-required" \
                     "/staging-<os>-optional for os in ${XR_STAGING_OSES[*]})" >&2
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
