// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import styles from './ExtensionBanner.module.css';

/**
 * Detect the `window.xchain` provider — injected by the XChain Wallet
 * extension's content script — and surface a banner offering the user
 * the option to use the extension wallet instead of the standalone web
 * app (§8.3).
 *
 * Detection timing: the inject script dispatches an
 * `xchain#initialized` event after attaching `window.xchain`. The
 * banner listens for that and also polls once after mount in case the
 * inject script ran before the React tree mounted.
 *
 * Dismissal: stored in `sessionStorage` so the banner doesn't nag on
 * every navigation, but reappears on a fresh tab so users who changed
 * their mind see it again.
 */
export function ExtensionBanner() {
    const [present, setPresent] = useState(false);
    const [dismissed, setDismissed] = useState(
        typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem('xc:ext-banner:dismissed') === '1',
    );

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const check = () => {
            if (window.xchain) setPresent(true);
        };
        check();
        const onInit = () => setPresent(true);
        window.addEventListener('xchain#initialized', onInit);
        return () => window.removeEventListener('xchain#initialized', onInit);
    }, []);

    if (!present || dismissed) return null;

    function dismiss() {
        setDismissed(true);
        try {
            sessionStorage?.setItem('xc:ext-banner:dismissed', '1');
        } catch (_err) { /* private-mode Safari */ }
    }

    return (
        <div role="status" className={styles.banner}>
            <span className={styles.label}>
                <strong>XChain Wallet extension detected.</strong>
                {' '}You can use your extension wallet — click its icon in
                the browser toolbar.
            </span>
            <button
                type="button"
                className={styles.dismiss}
                onClick={dismiss}
                aria-label="Dismiss extension notice"
            >
                Dismiss
            </button>
        </div>
    );
}
