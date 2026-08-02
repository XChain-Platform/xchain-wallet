# Build resources

electron-builder reads asset files from this directory.

- `entitlements.mac.plist` - macOS hardened-runtime entitlements (see
  the file's header comment for the rationale per entitlement).

- `icon.png`, `icon.icns`, `icon.ico` - **committed 2026-08-01 .**
  These were previously absent, and this file said so while calling the
  fallback "a fine fallback". It was not: nothing was tracking the gap,
  and the first real macOS lane run logged `default Electron icon is
  used` and produced an app whose `Info.plist` read
  `CFBundleIconFile = electron.icns`. The desktop shell was on course to
  ship Electron's own logo on all three OSes - the same defect 
  found on mobile, where both stores would likely have rejected it.

  - `icon.png` - 1024×1024 RGBA master (Linux, and the source of record)
  - `icon.icns` - macOS: 16/32/64/128/256/512/1024 plus @2x aliases
  - `icon.ico` - Windows: 16/24/32/48/64/256, PNG-compressed entries

  **Composition is inherited, not invented.** The geometry is copied from
  the already-approved iOS app icon : the chain-link mark alone,
  no wordmark (unreadable below ~64px), centred on a square canvas at
  **78% of canvas width** (measured 799/1024, side margin 112px) and
  vertically centred. The one deliberate difference from iOS is alpha:
  Apple forbids it on the 1024 store icon, while the macOS Dock and the
  Windows taskbar want it, so these are transparent.

  **Regenerating.** Every size is rendered from the vector at that size
  and then cropped, rather than downscaled from one master, so 16px stays
  crisp. Source: `XChain Logo.pdf` from the brand kit (`.ai`/`.eps`/`.pdf`
  under `dankest.llc/files/logo/XChain/`). Render with `sips` - it
  rasterises the PDF **with alpha preserved**, whereas ImageMagick is not
  an option here because its PDF delegate needs a Ghostscript that is not
  installed (the same trap  hit). Pack the `.icns` with `iconutil`
  from an `.iconset`. The `.ico` is a plain container: a 6-byte header,
  one 16-byte directory entry per image, then whole PNGs - written
  directly rather than adding a dependency for one build artifact.

  The three files are named explicitly in `electron-builder.config.cjs`
  (`mac.icon` / `win.icon` / `linux.icon`) rather than left to the
  implicit `build/icon.*` lookup, because that lookup is silent when it
  finds nothing, which is exactly how this went unnoticed. Deleting one
  now fails the build.

- `background.png` - DMG installer background, optional. If absent,
  electron-builder uses a plain grey background.
