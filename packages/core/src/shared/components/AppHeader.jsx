// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AppHeader: persistent top strip that stays mounted across every
// unlocked route. Brand on the left; the settings gear (wallet /
// account / network), QR/address dropdown, lock, and the pancake-menu
// button on the right. Living in the FullLayoutWithNav
// header slot means TokenDetail / Send / Receive / Settings all keep the
// wallet's top-level affordances visible without re-rendering their own
// copy. `onMenuOpen` fires when the pancake is tapped; the parent layout
// owns the menu drawer mount so it can span the viewport.
//
// : the gear leads the right-side stack so switching wallet or
// account is one tap from ANY unlocked route, not a walk through
// Settings -> Accounts. It renders only when the host wires at least one
// of the pickers or a complete network filter, so shells that supply
// none of them keep the old minimal bar.

import { useEffect, useRef, useState } from 'react';
import * as branding from '../../branding/branding.js';
import { Icon } from '../../ui/index.js';
import { HeaderSettingsButton } from './HeaderSettingsButton.jsx';
import styles from './AppHeader.module.css';

/**
 * @param {object} props
 * @param {() => void} [props.onMenuOpen]                            pancake-tap handler
 * @param {() => void} [props.onScan]                                when provided, the QR icon opens a dropdown with Scan plus the address options below
 * @param {() => void} [props.onManageAddresses]                     dropdown option under the QR icon: opens the address list
 * @param {() => void} [props.onViewAddress]                         dropdown option under the QR icon: opens the receive / view-address screen
 * @param {() => void} [props.onCommandPalette]                      when provided, renders a search button that opens the §33 command palette (Cmd/Ctrl+K)
 * @param {() => void} [props.onLock]                                when provided, renders a one-tap lock button; same action as the "Lock wallet" row in the pancake menu
 * @param {boolean} [props.locking]                                  disables the lock button while a lock is in flight
 * @param {{ id: string, name: string } | null} [props.activeWallet]              summary row in the gear popover
 * @param {{ id: string, name?: string, index?: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]                    gear popover: navigate to the wallet picker
 * @param {() => void} [props.onOpenAccountPicker]                   gear popover: navigate to the account picker
 * @param {boolean} [props.walletNonDefault]                         drives the gear's status dot
 * @param {boolean} [props.accountNonDefault]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {string[]} [props.coinFamilies]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {boolean} [props.showNetworkFilter]                        set false on routes where a network filter is meaningless (Send / Receive)
 */
export function AppHeader({
    onMenuOpen,
    onScan,
    onManageAddresses,
    onViewAddress,
    onCommandPalette,
    onLock,
    locking,
    activeWallet = null,
    activeAccount = null,
    onOpenWalletPicker,
    onOpenAccountPicker,
    walletNonDefault = false,
    accountNonDefault = false,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    showNetworkFilter = true,
}) {
    const networkWired = showNetworkFilter
        && Boolean(chainRegistry)
        && Array.isArray(coinFamilies)
        && coinFamilies.length > 0
        && typeof onNetworkFilterChange === 'function';
    const showSettings = typeof onOpenWalletPicker === 'function'
        || typeof onOpenAccountPicker === 'function'
        || networkWired;

    return (
        <header className={styles.bar} role="banner">
            <div className={styles.left}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
            </div>
            <div className={styles.right}>
                {showSettings ? (
                    <HeaderSettingsButton
                        activeWallet={activeWallet}
                        activeAccount={activeAccount}
                        onOpenWalletPicker={onOpenWalletPicker}
                        onOpenAccountPicker={onOpenAccountPicker}
                        walletNonDefault={walletNonDefault}
                        accountNonDefault={accountNonDefault}
                        chainRegistry={networkWired ? chainRegistry : undefined}
                        coinFamilies={networkWired ? coinFamilies : undefined}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={networkWired ? onNetworkFilterChange : undefined}
                    />
                ) : null}
                {onCommandPalette ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onCommandPalette}
                        aria-label="Open command palette"
                        aria-keyshortcuts="Meta+K Control+K"
                        title="Search (Cmd/Ctrl+K)"
                    >
                        <Icon.SearchIcon />
                    </button>
                ) : null}
                <ScanMenu
                    onScan={onScan}
                    onManageAddresses={onManageAddresses}
                    onViewAddress={onViewAddress}
                />
                {onLock ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onLock}
                        disabled={locking}
                        aria-label="Lock wallet"
                        title="Lock wallet"
                    >
                        <Icon.LockIcon />
                    </button>
                ) : null}
                {onMenuOpen ? (
                    <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={onMenuOpen}
                        aria-label="Open menu"
                        aria-haspopup="dialog"
                    >
                        <Icon.MenuIcon />
                    </button>
                ) : null}
            </div>
        </header>
    );
}

/**
 * QR-icon button that opens a small dropdown: Scan, Manage addresses,
 * View address. Only the options whose handler is supplied are shown.
 * Renders nothing when no handler is provided.
 *
 * @param {object} props
 * @param {() => void} [props.onScan]
 * @param {() => void} [props.onManageAddresses]
 * @param {() => void} [props.onViewAddress]
 */
function ScanMenu({ onScan, onManageAddresses, onViewAddress }) {
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

    const items = [
        { id: 'scan', label: 'Scan', Icon: Icon.ScanIcon, handler: onScan },
        { id: 'manage', label: 'Manage addresses', Icon: Icon.AddressIcon, handler: onManageAddresses },
        { id: 'view', label: 'View address', Icon: Icon.EyeIcon, handler: onViewAddress },
    ].filter((it) => typeof it.handler === 'function');

    if (items.length === 0) return null;

    return (
        <div ref={wrapRef} className={styles.scanWrap}>
            <button
                type="button"
                className={styles.menuBtn}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="Scan and addresses"
                title="Scan and addresses"
            >
                <Icon.ScanIcon />
            </button>
            {open ? (
                <div className={styles.scanMenu} role="menu" aria-label="Scan and addresses">
                    {items.map(({ id, label, Icon: ItemIcon, handler }) => (
                        <button
                            key={id}
                            type="button"
                            role="menuitem"
                            className={styles.scanItem}
                            onClick={() => { setOpen(false); handler(); }}
                        >
                            <span className={styles.scanItemIcon} aria-hidden="true">
                                <ItemIcon />
                            </span>
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
