// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Loading.module.css';

/**
 * @param {object} props
 * @param {string} [props.error]
 */
export function Loading({ error }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const centerClass = variant === 'small' ? styles.centerPopup : styles.centerFull;
    return (
        <Screen variant={variant}>
            <div className={centerClass}>
                {error ? (
                    <div role="alert" className={styles.error}>{error}</div>
                ) : (
                    <div aria-live="polite" className={styles.dots}>
                        <span /> <span /> <span />
                    </div>
                )}
            </div>
        </Screen>
    );
}
