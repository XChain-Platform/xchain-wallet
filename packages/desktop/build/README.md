# Build resources

electron-builder reads asset files from this directory.

- `entitlements.mac.plist` - macOS hardened-runtime entitlements (see
  the file's header comment for the rationale per entitlement).

- `icon.png`, `icon.icns`, `icon.ico` - **not yet committed.** Step 19
  ships the packaging pipeline; the icon assets themselves are a
  design task. Until they land, electron-builder uses its default
  placeholder icon in local dev builds (a fine fallback - production
  releases must commit real assets before the first public build).

  Target sizes when they land:
  - `icon.png` - 512×512 master (electron-builder generates the rest)
  - `icon.icns` - macOS, generated from the PNG master via
    `electron-icon-builder` or `iconutil`
  - `icon.ico` - Windows, multi-resolution (16 / 24 / 32 / 48 / 64 / 256)

- `background.png` - DMG installer background, optional. If absent,
  electron-builder uses a plain grey background.
