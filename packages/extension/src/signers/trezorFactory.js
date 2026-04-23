// Trezor Connect factory — extension (popup + service worker) target.
// Thin binding layer: the pair sequence itself lives in
// `@xchain-wallet/core/signerFactories/trezor.js` (Phase 2 Step 18, §40.12),
// shared with the web + desktop shells. This file owns the extension-
// specific `@trezor/connect-web` lazy-import + init (manifest, default
// `connectSrc` pointing at connect.trezor.io).
//
// Lazy-imports `@trezor/connect-web` so the SDK only loads when the
// user actually pairs a Trezor — keeps the extension's baseline
// bundle free of Trezor Connect's iframe bootstrap code until it's
// needed. Connect uses a popup/iframe that talks to the Trezor Bridge
// daemon (or WebUSB on supported browsers); the MV3 service worker
// can't host that directly, so the caller runs this from the
// extension's React popup.

// Cross-package relative path to core — matches the convention in
// hostBridge.js and messageHost.js so Node smoke scripts resolve the
// module without the pnpm workspace symlink.
import { makeTrezorFactory } from '../../../core/src/signerFactories/index.js';

/**
 * Manifest handed to Trezor Connect at init. Required — Trezor gates
 * the popup on a recognized manifest. Both fields must be accurate;
 * Trezor Connect may block unknown-origin manifests.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/** @type {Promise<import('@xchain-wallet/core/signers/TrezorSigner.js').TrezorConnect> | null} */
let connectPromise = null;

/**
 * Lazy-init Trezor Connect. Subsequent calls return the same instance.
 * The `loader` parameter exists for tests — in production pass the
 * real `@trezor/connect-web` package via `() => import('@trezor/connect-web')`.
 *
 * @param {() => Promise<any>} [loader]
 * @returns {Promise<import('@xchain-wallet/core/signers/TrezorSigner.js').TrezorConnect>}
 */
export async function getTrezorConnect(loader = defaultLoader) {
    if (!connectPromise) {
        connectPromise = (async () => {
            const mod = await loader();
            const TrezorConnect = mod?.default ?? mod;
            if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
                throw new Error('trezorFactory: loaded module does not look like @trezor/connect-web');
            }
            await TrezorConnect.init({
                manifest: MANIFEST,
                lazyLoad: true,
            });
            return TrezorConnect;
        })();
    }
    return connectPromise;
}

function defaultLoader() {
    return import('@trezor/connect-web');
}

/**
 * Pair a Trezor device. The pair sequence (getFeatures → derive device
 * identifier → construct TrezorSigner → return pairingInfo) lives in
 * core's `makeTrezorFactory`; this export is just the extension-side
 * binding.
 *
 * The caller is responsible for calling `flows.registerSigner` with
 * the returned `pairingInfo` to persist the SignerRecord.
 *
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]  for tests
 * @returns {ReturnType<ReturnType<typeof makeTrezorFactory>>}
 */
export async function pairTrezorSigner({ loader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
    });
    return factory();
}

/**
 * Reset the cached Connect instance. Primarily for tests; production
 * code rarely needs this outside of "log out of this extension
 * context" flows.
 */
export function resetTrezorConnect() {
    connectPromise = null;
}
