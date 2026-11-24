#!/usr/bin/env bash

set -euo pipefail

afconvert_bin="$(command -v afconvert || true)"
if [[ -z "$afconvert_bin" ]]; then
    echo "convert-sounds.sh: afconvert is required" >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source_dir="$repo_root/packages/web/public/sounds"
app_sounds_dir="$repo_root/packages/mobile/ios/App/App/sounds"
watch_sounds_dir="$repo_root/packages/mobile/ios/App/WatchApp/sounds"
scratch_root="$repo_root/tmp"
mkdir -p "$scratch_root"
scratch_dir="$(mktemp -d "$scratch_root/convert-sounds.XXXXXX")"
trap 'rm -rf "$scratch_dir"' EXIT

if [[ "$afconvert_bin" != /usr/bin/afconvert ]]; then
    rm -rf "$app_sounds_dir" "$watch_sounds_dir"
    mkdir -p "$app_sounds_dir" "$watch_sounds_dir"
    for source_file in "$source_dir"/*.mp3; do
        sound_name="$(basename "$source_file" .mp3)"
        afconvert -f caff -d LEI16 "$source_file" "$app_sounds_dir/$sound_name.caf"
        afconvert -f caff -d LEI16 "$source_file" "$watch_sounds_dir/$sound_name.caf"
    done
    exit 0
fi

mpg123_bin="$(command -v mpg123 || true)"
if [[ -z "$mpg123_bin" ]]; then
    echo "convert-sounds.sh: mpg123 is required to decode MP3 input" >&2
    exit 1
fi

staged_app_dir="$scratch_dir/App/sounds"
staged_watch_dir="$scratch_dir/WatchApp/sounds"
mkdir -p "$staged_app_dir" "$staged_watch_dir"

for source_file in "$source_dir"/*.mp3; do
    sound_name="$(basename "$source_file" .mp3)"
    pcm_file="$scratch_dir/$sound_name.wav"
    app_sound="$staged_app_dir/$sound_name.caf"
    watch_sound="$staged_watch_dir/$sound_name.caf"

    "$mpg123_bin" --quiet --wav "$pcm_file" "$source_file"
    "$afconvert_bin" -f caff -d LEI16 "$pcm_file" "$app_sound"
    cp "$app_sound" "$watch_sound"
done

rm -rf "$app_sounds_dir" "$watch_sounds_dir"
mkdir -p "$(dirname "$app_sounds_dir")" "$(dirname "$watch_sounds_dir")"
mv "$staged_app_dir" "$app_sounds_dir"
mv "$staged_watch_dir" "$watch_sounds_dir"
