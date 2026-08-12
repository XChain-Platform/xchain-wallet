// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §43.5 / Cluster F FOLLOWUP 2: React binding for the extension-wallet
// handoff. Turns the plain state in `extensionWallet.js` into the
// reactive surface the `ExtensionBanner` renders against: whether the
// provider is present, whether the user has accepted, the in-flight
// connect state, and the two actions (accept / switch back).

import { useCallback, useEffect, useState } from 'react';
import {
    connectExtensionWallet,
    disableExtensionWallet,
    hasExtensionProvider,
    readExtensionWalletPreference,
} from './extensionWallet.js';

/**
 * @typedef {object} ExtensionWalletState
 * @property {boolean} present    provider detected in the page
 * @property {boolean} enabled    user accepted AND provider present
 * @property {boolean} connecting a connect handshake is in flight
 * @property {string | null} error last connect failure message, if any
 * @property {() => Promise<boolean>} enable  run connect + persist; resolves true on success
 * @property {() => void} disable  forget the choice, revert to in-page wallet
 */

// Plain-English line for a refused connect. Branches on `error`, the
// BridgeErrorCode, exactly as bridge-spec tells dApps to; the wallet's own
// `message` is diagnostic text and is not shown to the user.
function errorMessageFor(result) {
    switch (result?.error) {
        case 'USER_REJECTED':
            return 'Connection declined in the wallet.';
        case 'BLOCKED_BY_USER':
            return 'This site is blocked. Un-block it in the wallet settings.';
        case 'WALLET_LOCKED':
            return 'Unlock the extension wallet, then try again.';
        case 'BRIDGE_VERSION_MISMATCH':
            return 'The extension wallet is too old for this app. Update it and try again.';
        case 'THROTTLED': {
            const seconds = Math.ceil((result.retryAfterMs ?? 0) / 1000);
            return seconds > 0
                ? `Too many requests. Try again in ${seconds}s.`
                : 'Too many requests. Try again shortly.';
        }
        default:
            return 'Could not connect to the extension.';
    }
}

/**
 * Track the extension provider and the user's routing preference.
 *
 * Detection mirrors the banner's original logic: the inject script fires
 * `xchain#initialized` after attaching `window.xchain`, and we also poll
 * once on mount in case the inject ran before this hook did.
 *
 * @returns {ExtensionWalletState}
 */
export function useExtensionWallet() {
    const [present, setPresent] = useState(false);
    const [enabled, setEnabled] = useState(
        () => readExtensionWalletPreference() && hasExtensionProvider(),
    );
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const detect = () => {
            if (hasExtensionProvider()) {
                setPresent(true);
                // A persisted preference only counts as "enabled" once the
                // provider is actually here; sync that now that it is.
                if (readExtensionWalletPreference()) setEnabled(true);
            }
        };
        detect();
        window.addEventListener('xchain#initialized', detect);
        return () => window.removeEventListener('xchain#initialized', detect);
    }, []);

    const enable = useCallback(async () => {
        setConnecting(true);
        setError(null);
        try {
            // bridge-spec's ConnectResult is a union: a user-rejected connect,
            // a blocked origin and a version mismatch all RESOLVE with
            // `ok: false` rather than throwing (). Reading "did not
            // throw" as success switched the app into extension-wallet mode on
            // a refusal, and the banner reported no error at all.
            const result = await connectExtensionWallet();
            if (result?.ok !== true) {
                setError(errorMessageFor(result));
                return false;
            }
            setEnabled(true);
            return true;
        } catch (err) {
            // The provider being absent (or a transport fault) still throws.
            setError(err?.message || 'Could not connect to the extension.');
            return false;
        } finally {
            setConnecting(false);
        }
    }, []);

    const disable = useCallback(() => {
        disableExtensionWallet();
        setEnabled(false);
        setError(null);
    }, []);

    return { present, enabled, connecting, error, enable, disable };
}
