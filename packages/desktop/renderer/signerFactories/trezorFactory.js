// Trezor Connect factory — Electron desktop renderer.
//
// Same shape as the extension binding (`packages/extension/src/signers/
// trezorFactory.js`): lazy-import `@trezor/connect-web`, init with the
// XChain manifest, bind core's `makeTrezorFactory` to the resulting
// connect instance. The only desktop-specific hook is the future
// `connectSrc` override — Step 19 will bundle the Connect iframe
// tokens alongside the app so signing never reaches out to
// connect.trezor.io. Until then we use the default (network-bound)
// connectSrc; real-device verification in Electron will exercise this
// path once Step 19 ships.
//
// Cross-package relative path keeps the smoke harness resolving this
// under plain Node without pnpm workspace symlinks.

import { makeTrezorFactory } from '@xchain-wallet/core/signerFactories';

/**
 * Trezor Connect manifest — must match a domain Trezor whitelists or
 * the popup blocks. Desktop uses the same manifest as extension/web
 * for now; a separate desktop manifest is a Step-19 follow-up.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/** @type {Promise<any> | null} */
let connectPromise = null;

/**
 * Lazy-init Trezor Connect. `loader` is injectable for tests; in
 * production this dynamic-imports `@trezor/connect-web`.
 *
 * @param {() => Promise<any>} [loader]
 */
export async function getTrezorConnect(loader = defaultLoader) {
    if (!connectPromise) {
        connectPromise = (async () => {
            const mod = await loader();
            const TrezorConnect = mod?.default ?? mod;
            if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
                throw new Error('desktop trezorFactory: loaded module does not look like @trezor/connect-web');
            }
            await TrezorConnect.init({
                manifest: MANIFEST,
                lazyLoad: true,
                // Step 19: add `connectSrc: 'app://trezor-connect/'` (or
                // whatever local protocol we register) to cut the
                // network dependency at sign-click.
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
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]
 */
export async function pairTrezorSigner({ loader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
    });
    return factory();
}

export function resetTrezorConnect() {
    connectPromise = null;
}
