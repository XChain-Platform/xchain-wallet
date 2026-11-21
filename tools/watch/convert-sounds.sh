#!/usr/bin/env bash

set -euo pipefail

if ! command -v afconvert >/dev/null 2>&1; then
    echo "convert-sounds.sh: afconvert is required" >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source_dir="$repo_root/packages/web/public/sounds"
app_sounds_dir="$repo_root/packages/mobile/ios/App/App/sounds"
watch_sounds_dir="$repo_root/packages/mobile/ios/App/WatchApp/sounds"

rm -rf "$app_sounds_dir" "$watch_sounds_dir"
mkdir -p "$app_sounds_dir" "$watch_sounds_dir"

for source_file in "$source_dir"/*.mp3; do
    sound_name="$(basename "$source_file" .mp3)"
    app_sound="$app_sounds_dir/$sound_name.caf"
    watch_sound="$watch_sounds_dir/$sound_name.caf"

    afconvert -f caff -d LEI16 "$source_file" "$app_sound"
    afconvert -f caff -d LEI16 "$source_file" "$watch_sound"
done
