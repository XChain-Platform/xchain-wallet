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
// unlocked route. Brand and wallet identity stay on the left. Lock and
// one overflow menu stay on the right. Living in the FullLayoutWithNav
// header slot means TokenDetail / Send / Receive / Settings all keep the
// wallet's top-level affordances visible without re-rendering their own
// copy. `onMenuOpen` fires from the overflow menu's More row; the parent
// layout owns the full menu mount so it can span the viewport.
//
import * as branding from '../../branding/branding.js';
import { Button, Icon } from '../../ui/index.js';
import { HeaderSettingsButton } from './HeaderSettingsButton.jsx';
import { HeaderActionMenu } from './HeaderActionMenu.jsx';
import { WatchOnlyBadge } from './WatchOnlyBadge.jsx';
import { WalletIdentity } from './WalletIdentity.jsx';
import styles from './AppHeader.module.css';
import { t } from '../../i18n/index.js';

/**
 * @param {object} props
 * @param {() => void} [props.onMenuOpen]                            opens the full wallet menu from the More row
 * @param {() => void} [props.onScan]                                adds a Scan row to the overflow menu
 * @param {() => void} [props.onManageAddresses]                     adds a Manage addresses row
 * @param {() => void} [props.onViewAddress]                         adds a View address row
 * @param {() => void} [props.onCommandPalette]                      keeps the Open command palette action in the menu (Cmd/Ctrl+K)
 * @param {() => void} [props.onLock]                                when provided, renders a one-tap lock button; same action as the "Lock wallet" row in the pancake menu
 * @param {boolean} [props.locking]                                  disables the lock button while a lock is in flight
 * @param {boolean} [props.isWatcherMode]                            shows the persistent watch-only wallet badge
 * @param {{ id: string, name: string } | null} [props.activeWallet]              summary row in the gear popover
 * @param {{ id: string, name?: string, index?: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]                    gear popover: navigate to the wallet picker
 * @param {() => void} [props.onOpenAccountPicker]                   gear popover: navigate to the account picker
 * @param {() => void} [props.onOpenSettings]                        gear popover: navigate to the full settings page
 * @param {boolean} [props.walletNonDefault]                         drives the gear's status dot
 * @param {boolean} [props.accountNonDefault]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {string[]} [props.coinFamilies]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {boolean} [props.showNetworkFilter]                        set false on routes where a network filter is meaningless (Send / Receive)
 * @param {'mainnet'|'testnet'|'regtest'} [props.activeNetwork]
 * @param {boolean} [props.developerMode]
 * @param {(network: 'mainnet'|'testnet'|'regtest') => Promise<void>} [props.onActiveNetworkChange]
 * @param {string} [props.platformCurrent]                           this surface's key in the *.xchain.io platform switcher (the web shell passes 'wallet'); omit to hide the switcher entirely, which is what the extension and desktop shells do
 * @param {() => void} [props.onPopOut]                              opens this wallet surface in a separate browser window or extension tab
 */
export function AppHeader({
    onMenuOpen,
    onScan,
    onManageAddresses,
    onViewAddress,
    onCommandPalette,
    onLock,
    locking,
    isWatcherMode = false,
    activeWallet = null,
    activeAccount = null,
    onOpenWalletPicker,
    onOpenAccountPicker,
    onOpenSettings,
    walletNonDefault = false,
    accountNonDefault = false,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    showNetworkFilter = true,
    activeNetwork,
    developerMode = false,
    onActiveNetworkChange,
    platformCurrent,
    onPopOut,
}) {
    const networkWired = showNetworkFilter
        && Boolean(chainRegistry)
        && Array.isArray(coinFamilies)
        && coinFamilies.length > 0
        && typeof onNetworkFilterChange === 'function';
    const showSettings = typeof onOpenWalletPicker === 'function'
        || typeof onOpenAccountPicker === 'function'
        || typeof onOpenSettings === 'function'
        || networkWired
        || typeof onActiveNetworkChange === 'function';

    return (
        // A labelled region, not a second banner: each screen's Screen header already
        // is the page banner, and a document may hold only one.
        <div
            className={styles.bar}
            role="region"
            aria-label={t('shell.header.appHeader')}
        >
            <div className={styles.left}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
                <WalletIdentity wallet={activeWallet} namePrefix={t('shell.header.walletPrefix')} />
                <WatchOnlyBadge visible={isWatcherMode} />
            </div>
            <div className={styles.right}>
                {onLock ? (
                    <Button
                        variant="secondary"
                        icon={<Icon.LockIcon />}
                        onClick={onLock}
                        disabled={locking}
                        aria-label={t('home.lockWallet')}
                        title={t('home.lockWallet')}
                        data-header-control
                    />
                ) : null}
                <HeaderActionMenu
                    settingsControl={showSettings ? (
                        <HeaderSettingsButton
                            menuRow
                            activeWallet={activeWallet}
                            activeAccount={activeAccount}
                            onOpenWalletPicker={onOpenWalletPicker}
                            onOpenAccountPicker={onOpenAccountPicker}
                            onOpenSettings={onOpenSettings}
                            walletNonDefault={walletNonDefault}
                            accountNonDefault={accountNonDefault}
                            chainRegistry={networkWired ? chainRegistry : undefined}
                            coinFamilies={networkWired ? coinFamilies : undefined}
                            networkFilter={networkFilter}
                            onNetworkFilterChange={networkWired ? onNetworkFilterChange : undefined}
                            activeNetwork={activeNetwork}
                            developerMode={developerMode}
                            onActiveNetworkChange={onActiveNetworkChange}
                        />
                    ) : null}
                    onCommandPalette={onCommandPalette}
                    onScan={onScan}
                    onManageAddresses={onManageAddresses}
                    onViewAddress={onViewAddress}
                    onPopOut={onPopOut}
                    onMore={onMenuOpen}
                    platformCurrent={platformCurrent}
                />
            </div>
        </div>
    );
}
