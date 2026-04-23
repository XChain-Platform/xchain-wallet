# @xchain-wallet/desktop

**Phase 2 — deferred.**

The Electron desktop shell is scaffolded but unshipped. See
[spec §40.12](../../docs/) ("Electron Desktop Shell Goes Live") for the
full Phase 2 delivery plan.

### Why this waits for Phase 2

The desktop shell's headline differentiators over the web + extension
shells are:

- **OS keychain integration** (macOS Keychain, Windows Credential
  Manager, libsecret).
- **Native USB/HID hardware-wallet transports** (`@trezor/connect`
  node, `@ledgerhq/hw-transport-node-hid`).

Hardware wallets (`TrezorSigner` / `LedgerSigner`) are Phase 2 per
spec §17.3–17.4 and §40.11. Shipping the desktop shell without them
would mean a desktop app whose standout features are stubs. Phase 2
bundles both together so the desktop app ships with its value intact.

Phase 1 users get the web SPA and the Chrome extension, both of which
cover the full send/receive/sign surface.
