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
import { Screen, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * WalletPicker — full-screen list of all wallets in the vault, with
 * an "Add Wallet" affordance in the header. Reached from the gear
 * popover's Wallet summary row. Picking a wallet calls `onSwitch`
 * and returns to home.
 *
 * Each row carries an info (ⓘ) button on the right; clicking it
 * navigates to WalletDetails (where the Rename affordance also lives).
 *
 * @param {object} props
 * @param {string | null} props.activeWalletId
 * @param {(walletId: string) => void} props.onSwitch
 * @param {() => void} props.onAddWallet
 * @param {(walletId: string) => void} [props.onShowDetails]
 * @param {() => void} props.onBack
 */
export function WalletPicker({
    activeWalletId,
    onSwitch,
    onAddWallet,
    onShowDetails,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listWallets !== 'function') {
            setError('messaging.listWallets is not available in this shell.');
            return undefined;
        }
        messaging.listWallets()
            .then((list) => { if (!cancelled) setWallets(Array.isArray(list) ? list : []); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load wallets.'); });
        return () => { cancelled = true; };
    }, [messaging]);

    const header = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={pickerStyles.title}>Wallets</span>
            <button
                type="button"
                onClick={onAddWallet}
                className={pickerStyles.iconBtn}
                aria-label="Add Wallet"
                title="Add Wallet"
            >
                <Icon.PlusIcon />
            </button>
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {error ? (
                    <div className={styles.entryDescription} role="alert">{error}</div>
                ) : wallets === null ? (
                    <div className={styles.entryDescription}>Loading…</div>
                ) : wallets.length === 0 ? (
                    <div className={styles.entryDescription}>No wallets yet.</div>
                ) : wallets.map((w) => {
                    const active = w.id === activeWalletId;
                    return (
                        <div key={w.id} className={pickerStyles.rowWrap}>
                            <button
                                type="button"
                                className={styles.entry}
                                style={{ width: '100%', paddingRight: '56px' }}
                                onClick={() => {
                                    if (!active) onSwitch(w.id);
                                    onBack();
                                }}
                            >
                                <span className={styles.entryLabel}>
                                    {active ? '● ' : '○ '}{w.name || 'Unnamed wallet'}
                                </span>
                                {w.format ? (
                                    <span className={styles.entryDescription}>
                                        {w.format === 'counterwallet-legacy' ? 'FreeWallet (legacy)' : 'BIP39'}
                                        {w.passphraseEnabled ? ' · 25th-word passphrase' : ''}
                                    </span>
                                ) : null}
                            </button>
                            {onShowDetails ? (
                                <button
                                    type="button"
                                    className={pickerStyles.rowMenuBtn}
                                    aria-label={`Wallet details for ${w.name || 'wallet'}`}
                                    title="Wallet details"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onShowDetails(w.id);
                                    }}
                                >
                                    <Icon.InfoIcon />
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </Screen>
    );
}
