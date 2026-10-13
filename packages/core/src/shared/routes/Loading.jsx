// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Loading.module.css';

/**
 * @param {object} props
 * @param {unknown} [props.error]
 * @param {() => void} [props.onRetry] defaults to reloading the app
 */
export function Loading({ error, onRetry }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const centerClass = variant === 'small' ? styles.centerPopup : styles.centerFull;

    function handleRetry() {
        if (onRetry) { onRetry(); return; }
        if (typeof window !== 'undefined') window.location.reload();
    }

    return (
        <Screen variant={variant}>
            <div className={centerClass}>
                {error ? (
                    <div role="alert" className={styles.errorPanel}>
                        <h1 className={styles.title}>The wallet could not start</h1>
                        <p className={styles.error}>
                            Something stopped the wallet from opening. Your wallet data has
                            not been changed.
                        </p>
                        <p className={styles.nextStep}>
                            Choose Try again. If the wallet still does not open, contact support
                            before clearing any wallet data.
                        </p>
                        <Button type="button" variant="primary" block onClick={handleRetry}>
                            Try again
                        </Button>
                    </div>
                ) : (
                    <div aria-live="polite" className={styles.dots}>
                        <span /> <span /> <span />
                    </div>
                )}
            </div>
        </Screen>
    );
}
