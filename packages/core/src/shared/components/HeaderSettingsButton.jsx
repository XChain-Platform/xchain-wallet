// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { NetworkFilter } from './NetworkFilter.jsx';
import styles from './HeaderSettingsButton.module.css';

/**
 * Header gear-icon → settings popover. Three sections:
 *
 *   ▸ Wallet     summary row showing the active wallet name; click
 *                navigates to the WalletPicker route (full list +
 *                Add Wallet affordance)
 *   ▸ Account    same shape; click navigates to AccountPicker
 *   ▸ Network    inline coin-family filter (quick toggle, no nav)
 *
 * Keeping the popover compact: full lists + add affordances belong on
 * dedicated pages where there's room for labels, descriptions, and
 * confirmation. The popover is just "what's active" + "tap to change".
 *
 * The gear icon shows a small dot when ANY non-default setting is
 * active (non-`all` network filter, non-first wallet, or non-first
 * account). Click outside / Escape closes.
 *
 * @param {object} props
 * @param {{ id: string, name: string } | null} [props.activeWallet]      the wallet to display in the summary row
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]                          host navigates to the wallet picker route
 * @param {() => void} [props.onOpenAccountPicker]                         host navigates to the account picker route
 * @param {boolean} [props.walletNonDefault]   used by the gear's status dot (caller knows whether the active wallet is the "first" one in the list)
 * @param {boolean} [props.accountNonDefault]
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string[]} props.coinFamilies
 * @param {string} props.networkFilter
 * @param {(coin: string) => void} props.onNetworkFilterChange
 */
export function HeaderSettingsButton({
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    walletNonDefault = false,
    accountNonDefault = false,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const filterActive = networkFilter && networkFilter !== 'all';
    const anyNonDefault = filterActive || walletNonDefault || accountNonDefault;

    const walletLabel = activeWallet?.name || null;
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : null);

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={`${styles.btn} ${anyNonDefault ? styles.btnActive : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="Settings"
                title="Settings"
            >
                <Icon.GearIcon />
                {anyNonDefault ? <span className={styles.dot} aria-hidden="true" /> : null}
            </button>
            {open ? (
                <div className={styles.popover} role="dialog" aria-label="Wallet settings">
                    {onOpenWalletPicker ? (
                        <Section title="Wallet">
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => { setOpen(false); onOpenWalletPicker(); }}
                            >
                                <span className={`${styles.summaryName} ${walletLabel ? '' : styles.summaryEmpty}`}>
                                    {walletLabel || 'No wallet'}
                                </span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </Section>
                    ) : null}

                    {onOpenAccountPicker && activeWallet ? (
                        <Section title="Account">
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => { setOpen(false); onOpenAccountPicker(); }}
                            >
                                <span className={`${styles.summaryName} ${accountLabel ? '' : styles.summaryEmpty}`}>
                                    {accountLabel || 'Account 1'}
                                </span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </Section>
                    ) : null}

                    <Section title="Network">
                        <NetworkFilter
                            chainRegistry={chainRegistry}
                            coinFamilies={coinFamilies}
                            value={networkFilter}
                            onChange={(next) => { onNetworkFilterChange(next); /* keep popover open */ }}
                        />
                    </Section>
                </div>
            ) : null}
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div className={styles.section}>
            <div className={styles.sectionLabel}>{title}</div>
            {children}
        </div>
    );
}
