// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { useExtensionWallet } from '../useExtensionWallet.js';
import styles from './ExtensionBanner.module.css';

/**
 * Detect the `window.xchain` provider, injected by the XChain Wallet
 * extension's content script, and offer to route the web app through the
 * extension wallet instead of running its own in-page wallet (§43.5).
 *
 * Behaviour (Cluster F FOLLOWUP 2): the banner is a stateful affordance,
 * not a one-shot notice. When the extension is detected it offers **Use
 * extension wallet**; accepting runs the §43.2 connect handshake and
 * persists the choice via `useExtensionWallet`, so the web page acts as
 * a dApp against the extension from then on. While the handshake is in
 * flight the button reads "Connecting…"; a rejected / failed connect
 * shows a short retry message and leaves the web app on its own wallet.
 * Once accepted the banner flips to an active state with **Switch back**.
 *
 * Detection timing: the inject script dispatches `xchain#initialized`
 * after attaching `window.xchain`; the hook listens for that and also
 * checks once on mount in case the inject ran first.
 *
 * Dismissal (the "not now" path) is stored in `sessionStorage` so the
 * banner doesn't nag on every navigation but reappears on a fresh tab.
 */
export function ExtensionBanner() {
    const { present, enabled, connecting, error, enable, disable } =
        useExtensionWallet();
    const [dismissed, setDismissed] = useState(
        typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem('xc:ext-banner:dismissed') === '1',
    );

    // Nothing to show until the extension is present. The active state is
    // shown even if the user dismissed the notice earlier: once they
    // opted in, they should be able to see it and switch back.
    if (!present) return null;
    if (!enabled && dismissed) return null;

    function dismiss() {
        setDismissed(true);
        try {
            sessionStorage?.setItem('xc:ext-banner:dismissed', '1');
        } catch (_err) { /* private-mode Safari */ }
    }

    if (enabled) {
        return (
            <div role="status" className={styles.banner} data-state="active">
                <span className={styles.label}>
                    <strong>Using your extension wallet.</strong>
                    {' '}Signing and account access route through the XChain
                    Wallet extension on this site.
                </span>
                <button
                    type="button"
                    className={styles.dismiss}
                    onClick={disable}
                >
                    Switch back
                </button>
            </div>
        );
    }

    return (
        <div role="status" className={styles.banner} data-state="offer">
            <span className={styles.label}>
                <strong>XChain Wallet extension detected.</strong>
                {' '}Use your extension wallet on this site instead of the
                web app.
                {error ? (
                    <span role="alert" className={styles.error}>
                        {' '}{error}
                    </span>
                ) : null}
            </span>
            <span className={styles.actions}>
                <button
                    type="button"
                    className={styles.accept}
                    onClick={enable}
                    disabled={connecting}
                >
                    {connecting ? 'Connecting…' : 'Use extension wallet'}
                </button>
                <button
                    type="button"
                    className={styles.dismiss}
                    onClick={dismiss}
                    aria-label="Dismiss extension notice"
                >
                    Not now
                </button>
            </span>
        </div>
    );
}
