// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MenuRoute: the wallet's pancake menu. Full-screen `<Screen>` with a
// Back-titled header, opened from the shared AppHeader's pancake button
// (`unlockedView === 'menu'`). This is the single live nav menu; the old
// `HeaderActionMenu` overlay drawer was removed (it had become orphaned
// dead code, its trigger was never rendered). It still reuses
// `HeaderActionMenu.module.css` for row styling.

import { Screen, ScreenHeader, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { LayoutModeToggle } from '../components/LayoutModeToggle.jsx';
import menuStyles from '../components/HeaderActionMenu.module.css';

/**
 * Props mirror HeaderActionMenu so the host can hand the same handlers
 * to either variant. `onBack` returns to whatever view the user was on
 * before tapping the pancake button.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} [props.onAlerts]
 * @param {() => void} [props.onMarkets]
 * @param {() => void} [props.onTokens]       opens the My Tokens page (tokens this wallet has issued)
 * @param {() => void} [props.onMoreActions]  opens the catch-all Token Actions page (all §40+ entries)
 * @param {() => void} [props.onMessaging]
 * @param {() => void} [props.onCrossChain]
 * @param {() => void} [props.onContacts]
 * @param {() => void} [props.onAddresses]
 * @param {() => void} [props.onContracts]
 * @param {() => void} [props.onStaking]
 * @param {() => void} [props.onMultisig]
 * @param {() => void} [props.onDispensers]    opens the Dispensers list
 * @param {() => void} [props.onSwitchWallet]  opens the wallet switcher (WalletPicker)
 * @param {() => void} [props.onLock]
 * @param {boolean} [props.locking]
 * @param {() => void} [props.onSettings]
 */
export function MenuRoute({
    onBack,
    onAlerts,
    onMarkets,
    onMarketActivity,
    onTokens,
    onMoreActions,
    onMessaging,
    onCrossChain,
    onContacts,
    onAddresses,
    onContracts,
    onStaking,
    onMultisig,
    onDispensers,
    onSwitchWallet,
    onLock,
    locking,
    onSettings,
}) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const primary = [
        { id: 'markets',          label: 'Decentralized Exchange', Icon: Icon.MarketIcon,   handler: onMarkets },
        { id: 'market-activity',  label: 'Marketplace', Icon: Icon.DollarIcon,   handler: onMarketActivity },
        { id: 'dispensers',       label: 'Dispensers',  Icon: Icon.HandshakeIcon, handler: onDispensers },
        { id: 'tokens',           label: 'My Tokens',   Icon: Icon.TokenIcon,    handler: onTokens },
        { id: 'alerts',           label: 'Alerts',      Icon: Icon.InfoIcon,     handler: onAlerts },
        { id: 'more-actions',     label: 'More actions', Icon: Icon.MoreIcon,    handler: onMoreActions },
        { id: 'messaging',    label: 'Messaging',   Icon: Icon.MessageIcon,  handler: onMessaging },
        { id: 'cross-chain', label: 'Cross-chain', Icon: Icon.LinkIcon,     handler: onCrossChain },
        { id: 'contacts',    label: 'Contacts',    Icon: Icon.UsersIcon,    handler: onContacts },
        { id: 'addresses',   label: 'Addresses',   Icon: Icon.ScanIcon,     handler: onAddresses },
        { id: 'contracts',   label: 'Contracts',   Icon: Icon.ContractIcon, handler: onContracts },
        { id: 'staking',     label: 'Staking',     Icon: Icon.StakeIcon,    handler: onStaking },
        { id: 'multisig',    label: 'Multisig',    Icon: Icon.MultisigIcon, handler: onMultisig },
    ]
        .filter((e) => typeof e.handler === 'function')
        // Main menu items are shown alphabetically by label. Switch
        // wallet / Settings / Lock stay pinned at the bottom (rendered
        // separately below), not part of this sort.
        .sort((a, b) => a.label.localeCompare(b.label));

    const header = <ScreenHeader onBack={onBack} title="Menu" />;

    return (
        <Screen variant={variant} header={header}>
            <div className={menuStyles.scroll}>
                {primary.length > 0 || typeof onSettings === 'function' ? (
                    <ul className={menuStyles.list} role="list">
                        {primary.map(({ id, label, Icon: ItemIcon, handler }) => (
                            <li key={id}>
                                <button
                                    type="button"
                                    className={menuStyles.row}
                                    onClick={handler}
                                >
                                    <span className={menuStyles.rowIcon} aria-hidden="true">
                                        <ItemIcon />
                                    </span>
                                    <span className={menuStyles.rowLabel}>{label}</span>
                                    <span className={menuStyles.rowChevron} aria-hidden="true">
                                        <Icon.ForwardIcon />
                                    </span>
                                </button>
                            </li>
                        ))}
                        {typeof onSwitchWallet === 'function' ? (
                            <li>
                                <button
                                    type="button"
                                    className={menuStyles.row}
                                    onClick={onSwitchWallet}
                                >
                                    <span className={menuStyles.rowIcon} aria-hidden="true">
                                        <Icon.KeyIcon />
                                    </span>
                                    <span className={menuStyles.rowLabel}>Switch wallet</span>
                                    <span className={menuStyles.rowChevron} aria-hidden="true">
                                        <Icon.ForwardIcon />
                                    </span>
                                </button>
                            </li>
                        ) : null}
                        {typeof onSettings === 'function' ? (
                            <li>
                                <button
                                    type="button"
                                    className={menuStyles.row}
                                    onClick={onSettings}
                                >
                                    <span className={menuStyles.rowIcon} aria-hidden="true">
                                        <Icon.GearIcon />
                                    </span>
                                    <span className={menuStyles.rowLabel}>Settings</span>
                                    <span className={menuStyles.rowChevron} aria-hidden="true">
                                        <Icon.ForwardIcon />
                                    </span>
                                </button>
                            </li>
                        ) : null}
                    </ul>
                ) : null}
            </div>
            <LayoutModeToggle />
            {typeof onLock === 'function' ? (
                <div className={menuStyles.lockBlock}>
                    <button
                        type="button"
                        className={menuStyles.lockBtn}
                        onClick={onLock}
                        disabled={locking}
                    >
                        <span className={menuStyles.rowIcon} aria-hidden="true">
                            <Icon.LockIcon />
                        </span>
                        <span className={menuStyles.rowLabel}>Lock wallet</span>
                    </button>
                </div>
            ) : null}
        </Screen>
    );
}
