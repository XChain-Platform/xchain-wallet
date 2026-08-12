// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §43.5 / Cluster F FOLLOWUP 2: web-app "use the extension wallet"
// handoff.
//
// The `ExtensionBanner` detects the extension's injected `window.xchain`
// provider. When the user accepts, the web app stops acting as its own
// standalone wallet for the surfaces the bridge can serve and instead
// forwards those calls to the extension (the web page becomes a dApp
// under §43). This module owns the two durable pieces of that handoff:
//
//   1. The persisted preference (localStorage `xc:use-extension-wallet`).
//      It survives reloads so a user who accepted once keeps talking to
//      the extension, and it is scrubbed on "switch back".
//   2. The bridge-native forwarding helpers. The web shell's own
//      messaging layer is vault + password driven (`walletId`,
//      `addressId`, `password`); the bridge is origin + approval driven
//      (`chainId`, `address`, extension-side password prompt). The two
//      auth models are not drop-in swappable, so the forward helpers
//      speak the bridge's shapes directly rather than translating the
//      local vault routes. Callers that have bridge-shaped inputs
//      (accounts, addresses, balances, signing) use these; wallet
//      management (create / import / unlock / lock) stays local because
//      the bridge is intentionally not a wallet-management API.
//
// Kept framework-agnostic (no React) so it is unit-testable under Node /
// jsdom and reusable by any shell surface; `useExtensionWallet.js` wraps
// it for the banner.

/**
 * localStorage key holding the user's "route through the extension"
 * preference. `'1'` means enabled; absent / anything else means the web
 * app runs its own in-page wallet.
 */
export const EXT_WALLET_PREF_KEY = 'xc:use-extension-wallet';

/** Thrown when a forward helper runs but no provider is present. */
export class ExtensionUnavailableError extends Error {
    constructor(method) {
        super(
            `XChain extension provider not detected` +
                (method ? ` (needed for ${method})` : ''),
        );
        this.name = 'ExtensionUnavailableError';
    }
}

/**
 * The injected provider, or `undefined` when the extension isn't
 * installed / hasn't injected yet. Guards `window` so the module loads
 * under Node (smoke / unit) without a DOM.
 *
 * @returns {any}
 */
export function getExtensionProvider() {
    if (typeof window === 'undefined') return undefined;
    return /** @type {any} */ (window).xchain;
}

/**
 * True when a genuine XChain provider is present. Checks the
 * `isXChainWallet` brand so a page-injected impostor object under the
 * same global name can't masquerade as the wallet.
 *
 * @returns {boolean}
 */
export function hasExtensionProvider() {
    const provider = getExtensionProvider();
    return Boolean(provider && provider.isXChainWallet);
}

/**
 * Read the persisted preference. A `try/catch` covers private-mode
 * Safari, where `localStorage` access throws.
 *
 * @returns {boolean}
 */
export function readExtensionWalletPreference() {
    try {
        return (
            typeof localStorage !== 'undefined' &&
            localStorage.getItem(EXT_WALLET_PREF_KEY) === '1'
        );
    } catch (_err) {
        return false;
    }
}

/**
 * Persist (or clear) the preference.
 *
 * @param {boolean} enabled
 */
export function writeExtensionWalletPreference(enabled) {
    try {
        if (typeof localStorage === 'undefined') return;
        if (enabled) localStorage.setItem(EXT_WALLET_PREF_KEY, '1');
        else localStorage.removeItem(EXT_WALLET_PREF_KEY);
    } catch (_err) {
        /* private-mode Safari: preference is in-session only */
    }
}

/**
 * Effective mode: the user opted in AND the provider is actually
 * reachable. A stale preference must never strand the web app in a mode
 * it can't serve (e.g. the user uninstalled the extension), so presence
 * is re-checked every call rather than trusted from the flag alone.
 *
 * @returns {boolean}
 */
export function isExtensionWalletEnabled() {
    return readExtensionWalletPreference() && hasExtensionProvider();
}

/**
 * Perform the §43.2 connect handshake and, on success, persist the
 * preference so the choice survives a reload. Throws if the provider is
 * absent or the user rejects the connect prompt (the caller surfaces
 * that on the banner without persisting anything).
 *
 * @param {object} [opts] connect options forwarded to the provider, named as
 *   bridge-spec's ConnectOpts declares them: `{ requestedChains,
 *   requiredBridgeVersion, appName, appIcon }`. This doc said `{ chains,
 *   accounts }`, which documented the handler's mistake rather than the
 *   contract (); the handler still accepts the legacy names.
 * @returns {Promise<any>} the provider's connect result
 */
export async function connectExtensionWallet(opts = {}) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('connect');
    const result = await provider.connect(opts);
    writeExtensionWalletPreference(true);
    return result;
}

/**
 * Forget the choice and go back to the in-page wallet. Only clears the
 * preference; it does not tear down any existing bridge session (the
 * user can revoke that from the extension's Connected Sites view).
 */
export function disableExtensionWallet() {
    writeExtensionWalletPreference(false);
}

// --- Bridge-native forwarding seam -----------------------------------
//
// These wrap the provider's read + signing methods so app code has a
// single import surface for the extension-backed path and a single place
// where "no provider" is turned into a typed error. Params + return
// shapes are the bridge's, verbatim (see
// packages/extension/src/inject/xchainProvider.js and the bridge
// handlers), so no lossy vault-route translation happens here.

/** @returns {Promise<Array<{ id: string, name: string }>>} */
export function forwardGetAccounts() {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('getAccounts');
    return provider.getAccounts();
}

/** @param {string} chainId */
export function forwardGetAddresses(chainId) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('getAddresses');
    return provider.getAddresses(chainId);
}

/** @param {string} chainId @param {string} address */
export function forwardGetBalances(chainId, address) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('getBalances');
    return provider.getBalances(chainId, address);
}

/** @returns {Promise<Array<object>>} */
export function forwardGetSupportedChains() {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('getSupportedChains');
    return provider.getSupportedChains();
}

/** @param {{ chainId: string, address: string, message: string }} params */
export function forwardSignMessage(params) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('signMessage');
    return provider.signMessage(params);
}

/** @param {{ chainId: string, action: object }} params */
export function forwardSignAction(params) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('signAction');
    return provider.signAction(params);
}

/** @param {{ chainId: string, psbtHex: string, signingPaths?: unknown }} params */
export function forwardSignPsbt(params) {
    const provider = getExtensionProvider();
    if (!provider) throw new ExtensionUnavailableError('signPsbt');
    return provider.signPsbt(params);
}
