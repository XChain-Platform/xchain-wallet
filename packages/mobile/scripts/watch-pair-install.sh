#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

usage() {
    echo "usage: packages/mobile/scripts/watch-pair-install.sh --phone <udid> --watch <udid> --app <path to App.app>" >&2
    exit 2
}

phone=""
watch=""
app=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --phone)
            [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || usage
            phone="$2"
            shift 2
            ;;
        --watch)
            [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || usage
            watch="$2"
            shift 2
            ;;
        --app)
            [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || usage
            app="$2"
            shift 2
            ;;
        *) usage ;;
    esac
done

[ -n "$phone" ] && [ -n "$watch" ] && [ -n "$app" ] || usage

if [ ! -d "$app" ]; then
    echo "watch-pair-install: app is not a directory: $app" >&2
    exit 1
fi

watch_apps=()
if [ -d "$app/Watch" ]; then
    shopt -s nullglob
    for candidate in "$app"/Watch/*.app; do
        [ -d "$candidate" ] && watch_apps+=("$candidate")
    done
    shopt -u nullglob
fi

if [ "${#watch_apps[@]}" -ne 1 ]; then
    echo "watch-pair-install: expected exactly one watch app in $app/Watch" >&2
    exit 1
fi
watch_app="${watch_apps[0]}"

if ! xcrun simctl install "$phone" "$app"; then
    echo "watch-pair-install: phone install failed: $app" >&2
    exit 1
fi
if ! xcrun simctl install "$watch" "$watch_app"; then
    echo "watch-pair-install: watch install failed: $watch_app" >&2
    exit 1
fi

status=0
if ! xcrun simctl get_app_container "$phone" io.xchain.wallet.ios >/dev/null 2>&1; then
    echo "watch-pair-install: io.xchain.wallet.ios is not installed" >&2
    status=1
fi
if ! xcrun simctl get_app_container "$watch" io.xchain.wallet.ios.watch >/dev/null 2>&1; then
    echo "watch-pair-install: io.xchain.wallet.ios.watch is not installed" >&2
    status=1
fi

[ "$status" -eq 0 ] || exit 1
echo "watch pair install: io.xchain.wallet.ios and io.xchain.wallet.ios.watch installed"
