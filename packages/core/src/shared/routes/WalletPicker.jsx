// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { EmptyState, Icon, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * WalletPicker: full-screen list of all wallets in the vault, with
 * an "Add Wallet" affordance in the header. Reached from the gear
 * popover's Wallet summary row. Picking a wallet calls `onSwitch`
 * and returns to the screen that opened the picker.
 *
 * Each row carries an info (ⓘ) button on the right; clicking it
 * navigates to WalletDetails (where the Rename affordance also lives).
 *
 * @param {object} props
 * @param {string | null} props.activeWalletId
 * @param {(walletId: string) => void | Promise<void>} props.onSwitch
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

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [switchingWalletId, setSwitchingWalletId] = useState(/** @type {string | null} */ (null));
    const [switchError, setSwitchError] = useState(/** @type {string | null} */ (null));

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

    async function handleSelect(walletId, active) {
        if (switchingWalletId) return;
        if (active) {
            onBack();
            return;
        }
        setSwitchingWalletId(walletId);
        setSwitchError(null);
        try {
            await onSwitch(walletId);
            onBack();
        } catch (err) {
            setSwitchError(err?.message || 'Failed to switch wallets.');
        } finally {
            setSwitchingWalletId(null);
        }
    }

    const switching = switchingWalletId !== null;

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={switching}
            title="Wallets"
            trailing={(
                <button
                    type="button"
                    onClick={onAddWallet}
                    aria-label="Add wallet"
                    title="Add wallet"
                    disabled={switching}
                >
                    <Icon.PlusIcon />
                </button>
            )}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {switchError ? (
                    <StatusMessage variant="error" className={styles.entryDescription}>{switchError}</StatusMessage>
                ) : null}
                {error ? (
                    <StatusMessage variant="error" className={styles.entryDescription}>{error}</StatusMessage>
                ) : wallets === null ? (
                    <div className={styles.entryDescription}>Loading…</div>
                ) : wallets.length === 0 ? (
                    <EmptyState title="No wallets yet" body="Wallets available to this app appear here." />
                ) : wallets.map((w) => {
                    const active = w.id === activeWalletId;
                    return (
                        <div key={w.id} className={pickerStyles.rowWrap}>
                            <button
                                type="button"
                                className={styles.entry}
                                style={{ width: '100%', paddingRight: '56px' }}
                                onClick={() => handleSelect(w.id, active)}
                                disabled={switching}
                                aria-busy={switchingWalletId === w.id ? 'true' : undefined}
                            >
                                <span className={`${styles.entryText} ${pickerStyles.rowText}`}>
                                    <span className={styles.entryLabel}>
                                        {active ? '● ' : '○ '}{w.name || 'Unnamed wallet'}
                                    </span>
                                    {w.format ? (
                                        <span className={styles.entryDescription}>
                                            {w.format === 'counterwallet-legacy' ? 'FreeWallet (legacy)' : 'BIP39'}
                                            {/* A stored passphrase (passphraseStored) unlocks on the
                                                password alone, so it earns no badge here; only a legacy
                                                record still owed its one-time capture does, and the badge
                                                names the unlock screen as where that happens. */}
                                            {w.passphraseEnabled && !w.passphraseStored ? ' · needs its passphrase at unlock' : ''}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                            {onShowDetails ? (
                                <button
                                    type="button"
                                    className={pickerStyles.rowMenuBtn}
                                    aria-label={`Wallet details for ${w.name || 'wallet'}`}
                                    title="Wallet details"
                                    disabled={switching}
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
            </ListPage>
        </Screen>
    );
}
