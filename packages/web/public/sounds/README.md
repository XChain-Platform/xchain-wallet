# Notification sound palette

The event sounds the wallet can play with an in-app notification
(Settings > Notifications > Notification sounds; off by default). They are
served from this directory as plain files, so the build never inlines them
as `data:` URIs the CSP would block, and the Capacitor mobile shell ships
them verbatim inside the built web SPA.

## Source and license

Every file is derived from **Interface Sounds 1.0 by Kenney**
(https://kenney.nl/assets/interface-sounds), released under
**Creative Commons Zero (CC0 1.0)**. Kenney's license text is committed
beside the files as `LICENSE.txt`, verbatim from the pack. Crediting Kenney
is appreciated by the author and not required by the license.

| Palette id | Kenney source file |
|---|---|
| `chime` | `confirmation_001.ogg` |
| `glass` | `glass_004.ogg` |
| `bell` | `glass_001.ogg` |
| `pluck` | `pluck_001.ogg` |
| `ping` | `question_001.ogg` |
| `alert` | `error_001.ogg` |
| `drop` | `drop_001.ogg` |
| `bong` | `bong_001.ogg` |

The palette manifest the wallet reads (ids, labels, per-kind defaults) is
`packages/core/src/notifications/notificationSounds.js`; a file added here
is not a sound until it is listed there.

## Encoding

MP3 rather than the pack's OGG because Safari (the iOS wrapper's engine)
does not decode Vorbis. Mono, 32 kHz, 48 kbps constant bit rate, all
metadata and ID3 tags stripped; every file is under 5 KB against the
32 KB budget the spec sets per file. To re-encode from the pack:

```sh
ffmpeg -i <source>.ogg -ac 1 -ar 32000 -b:a 48k -map_metadata -1 \
  -id3v2_version 0 -write_xing 0 <id>.mp3
```
