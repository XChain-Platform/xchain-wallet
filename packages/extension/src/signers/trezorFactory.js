// Trezor Connect factory — extension (popup + service worker) target.
// Lazy-imports `@trezor/connect-web` so the SDK only loads when the
// user actually pairs a Trezor. Keeps the extension's baseline bundle
// free of Trezor Connect's iframe bootstrap code until it's needed.
//
// Trezor Connect opens a popup that talks to the Trezor Bridge daemon
// (or WebUSB on supported browsers). The popup needs a tab anchor —
// the MV3 service worker can't host a popup directly, so the caller
// runs this from the extension's React popup (popup.html) or from a
// transient action tab opened via `chrome.tabs.create`.
//
// Initialization is module-scoped (one `connect` instance per popup
// lifetime). Re-pairing the same device reuses the same instance;
// switching extension contexts requires re-init.

import {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
} from '@xchain-wallet/core';

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
 * Pair a Trezor device. Reads features from the device, constructs a
 * TrezorSigner, and returns it alongside the metadata the caller
 * needs to persist via `registerSigner`:
 *
 *   { signer, pairingInfo: { vendor, model, deviceIdentifier, firmwareVersion } }
 *
 * The caller is responsible for calling `flows.registerSigner` with
 * `pairingInfo` to persist the SignerRecord.
 *
 * @param {Object} opts
 * @param {() => Promise<any>} [opts.loader]  for tests
 * @returns {Promise<{ signer: TrezorSigner, pairingInfo: { vendor: 'trezor', model: string, deviceIdentifier: string, firmwareVersion: string | null } }>}
 */
export async function pairTrezorSigner({ loader } = {}) {
    const connect = await getTrezorConnect(loader);
    const res = await connect.getFeatures();
    if (!res?.success) {
        const msg = res?.payload?.error ?? res?.error?.error ?? 'Trezor pairing was cancelled or failed';
        throw new Error(`pairTrezorSigner: ${msg}`);
    }
    const features = res.payload;
    const deviceIdentifier = deviceIdentifierFromFeatures(features);
    const model = modelFromFeatures(features);
    const firmwareVersion = firmwareVersionFromFeatures(features);
    if (!deviceIdentifier) {
        throw new Error('pairTrezorSigner: device did not report a device_id or fw_fingerprint');
    }
    if (!model) {
        throw new Error('pairTrezorSigner: device did not report a model');
    }
    const label = features.label || 'Trezor';
    const signer = new TrezorSigner({
        id: `trezor-${deviceIdentifier}`,
        displayName: `${label} (${model})`,
        model,
        deviceIdentifier,
        connect,
    });
    return {
        signer,
        pairingInfo: {
            vendor: 'trezor',
            model,
            deviceIdentifier,
            firmwareVersion,
        },
    };
}

/**
 * Reset the cached Connect instance. Primarily for tests; production
 * code rarely needs this outside of "log out of this extension
 * context" flows.
 */
export function resetTrezorConnect() {
    connectPromise = null;
}
