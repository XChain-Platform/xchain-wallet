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
import { useViewportClamp } from '../hooks/useViewportClamp.js';
import {
    activeNetworkLabel,
    activeNetworkOptions,
    confirmActiveNetworkSwitch,
    normalizeActiveNetwork,
} from '../utils/activeNetworkSwitch.js';
import styles from './HeaderSettingsButton.module.css';
import { useBackHandler } from '../../ui/backStack.js';

/**
 * Header gear-icon → settings popover. Four sections:
 *
 *   ▸ Wallet     summary row showing the active wallet name; click
 *                navigates to the WalletPicker route (full list +
 *                Add Wallet affordance)
 *   ▸ Account    same shape; click navigates to AccountPicker
 *   ▸ Network    active Mainnet / Testnet / Regtest switch
 *   ▸ Chain filter inline coin-family filter (quick toggle, no nav)
 *
 * Every section is opt-in: a host that only wires the pickers gets a
 * pure wallet/account switcher, and a host that only wires a network
 * control gets a network-only button. Sections whose handlers are missing
 * are omitted rather than rendered inert.
 *
 * Keeping the popover compact: full lists + add affordances belong on
 * dedicated pages where there's room for labels, descriptions, and
 * confirmation. The popover is just "what's active" + "tap to change".
 *
 * The gear icon shows a small dot when ANY non-default setting is
 * active (non-Mainnet network, non-`all` chain filter, non-first wallet,
 * or non-first account). Click outside / Escape closes.
 *
 * @param {object} props
 * @param {{ id: string, name: string } | null} [props.activeWallet]      the wallet to display in the summary row
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]                          host navigates to the wallet picker route
 * @param {() => void} [props.onOpenAccountPicker]                         host navigates to the account picker route
 * @param {() => void} [props.onOpenSettings]                              host navigates to the full settings route
 * @param {boolean} [props.walletNonDefault]   used by the gear's status dot (caller knows whether the active wallet is the "first" one in the list)
 * @param {boolean} [props.accountNonDefault]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {string[]} [props.coinFamilies]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]   omit (or omit the registry / families) to drop the Network section entirely
 * @param {'mainnet'|'testnet'|'regtest'} [props.activeNetwork]
 * @param {boolean} [props.developerMode]
 * @param {(network: 'mainnet'|'testnet'|'regtest') => Promise<void>} [props.onActiveNetworkChange]
 */
export function HeaderSettingsButton({
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    onOpenSettings,
    walletNonDefault = false,
    accountNonDefault = false,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    activeNetwork,
    developerMode = false,
    onActiveNetworkChange,
}) {
    const [open, setOpen] = useState(false);
    const [switchingNetwork, setSwitchingNetwork] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    // The system Back gesture and Escape close this before it leaves the
    // screen; the shared stack consumes Escape, so focus goes back here.
    useBackHandler(open ? () => { setOpen(false); triggerRef.current?.focus(); } : undefined);
    // The gear sits wherever the header puts it; at phone width that is
    // near the left edge, and a panel aligned to it would hang off-screen.
    const clamp = useViewportClamp(open);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // The Network section needs all four pieces to render anything
    // useful; NetworkFilter dereferences the registry and maps over the
    // families, so a partially-wired host must get no section at all
    // rather than a crash.
    const showNetwork = Boolean(chainRegistry)
        && Array.isArray(coinFamilies)
        && coinFamilies.length > 0
        && typeof onNetworkFilterChange === 'function';
    const hasActiveNetwork = activeNetwork === 'mainnet'
        || activeNetwork === 'testnet'
        || activeNetwork === 'regtest';
    const showActiveNetwork = hasActiveNetwork && typeof onActiveNetworkChange === 'function';
    const currentNetwork = normalizeActiveNetwork(activeNetwork);
    const networkOptions = activeNetworkOptions({ developerMode, current: currentNetwork });

    const filterActive = showNetwork && networkFilter && networkFilter !== 'all';
    const anyNonDefault = Boolean(filterActive)
        || (hasActiveNetwork && currentNetwork !== 'mainnet')
        || walletNonDefault
        || accountNonDefault;

    const walletLabel = activeWallet?.name || null;
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : null);

    const switchNetwork = async (next) => {
        if (next === currentNetwork) return;
        if (!confirmActiveNetworkSwitch(currentNetwork, next)) return;
        setSwitchingNetwork(true);
        try {
            await onActiveNetworkChange(next);
        } catch (err) {
            // Keep the current badge and selection when persistence fails.
            setSwitchingNetwork(false);
            // eslint-disable-next-line no-console
            console.error('activeNetwork update failed:', err);
        }
    };

    return (
        <div ref={wrapRef} className={styles.wrap}>
            {hasActiveNetwork ? (
                <span
                    className={`${styles.networkBadge} ${currentNetwork === 'mainnet' ? '' : styles.networkBadgeNonMainnet}`}
                    aria-label={`Active network: ${activeNetworkLabel(currentNetwork)}`}
                    title={`Active network: ${activeNetworkLabel(currentNetwork)}`}
                >
                    {/* Short form for phone widths: the dot shows and the
                        name is visually hidden but still read out, so the
                        badge never renders as clipped letters. */}
                    <span className={styles.networkBadgeDot} aria-hidden="true" />
                    <span className={styles.networkBadgeText}>{activeNetworkLabel(currentNetwork)}</span>
                </span>
            ) : null}
            <button
                ref={triggerRef}
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
                <div
                    ref={clamp.ref}
                    style={clamp.style}
                    className={styles.popover}
                    role="dialog"
                    aria-label="Wallet settings"
                >
                    {onOpenWalletPicker ? (
                        <Section title="Wallet">
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => { setOpen(false); onOpenWalletPicker(); }}
                                title={walletLabel || 'Choose wallet'}
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
                                title={accountLabel || 'Choose account'}
                            >
                                <span className={`${styles.summaryName} ${accountLabel ? '' : styles.summaryEmpty}`}>
                                    {accountLabel || 'Account 1'}
                                </span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </Section>
                    ) : null}

                    {showActiveNetwork ? (
                        <Section title="Network">
                            <select
                                className={styles.networkSelect}
                                value={currentNetwork}
                                disabled={switchingNetwork}
                                onChange={(event) => switchNetwork(event.target.value)}
                                aria-label="Active network in header"
                            >
                                {networkOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </Section>
                    ) : null}

                    {showNetwork ? (
                        <Section title="Chain filter">
                            <NetworkFilter
                                chainRegistry={chainRegistry}
                                coinFamilies={coinFamilies}
                                value={networkFilter || 'all'}
                                onChange={(next) => { onNetworkFilterChange(next); /* keep popover open */ }}
                            />
                        </Section>
                    ) : null}

                    {onOpenSettings ? (
                        <div className={styles.section}>
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => { setOpen(false); onOpenSettings(); }}
                                title="All settings"
                            >
                                <span className={styles.summaryName}>All settings</span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </div>
                    ) : null}
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
