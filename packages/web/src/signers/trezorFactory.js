// Trezor Connect factory — web-app target. Same popup-based transport
// as the extension (browsers that support it open the Connect popup;
// non-supported browsers surface a compatibility notice per §18.1).
//
// This file is intentionally a thin wrapper around the extension's
// factory: both targets use `@trezor/connect-web` with the same
// initialization and pairing shape. Only the desktop target (§18.1
// table) swaps in `@trezor/connect` (node) — that's a Piece-5 factory.
//
// Keeping the implementation in `extension/src/signers/trezorFactory.js`
// and re-exporting here lets a single fix reach both shells. If the
// two transports ever diverge (different manifest, browser-specific
// polyfills), fork this file then.

// Cross-package relative path rather than the workspace specifier —
// matches hostBridge.js's convention so Node smoke tests resolve the
// module without the pnpm workspace symlink, while Vite still bundles
// it cleanly at build time.
export {
    getTrezorConnect,
    pairTrezorSigner,
    resetTrezorConnect,
} from '../../../extension/src/signers/trezorFactory.js';
