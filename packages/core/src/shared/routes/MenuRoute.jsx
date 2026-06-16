// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MenuRoute — full-screen pancake menu (replaces the overlay drawer in
// the web shell). The route renders the same item list HeaderActionMenu
// shows, but as a normal `<Screen>` with a Back-titled header instead
// of a sliding panel over the page underneath. The drawer variant in
// `HeaderActionMenu` stays around for the small/popup shell.

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
 * @param {number} [props.alertCount]
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
 * @param {() => void} [props.onLock]
 * @param {boolean} [props.locking]
 * @param {() => void} [props.onSettings]
 */
export function MenuRoute({
    onBack,
    onAlerts,
    alertCount = 0,
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
    onLock,
    locking,
    onSettings,
}) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const primary = [
        { id: 'markets',          label: 'Decentralized Exchange', Icon: Icon.MarketIcon,   handler: onMarkets },
        { id: 'market-activity',  label: 'Marketplace', Icon: Icon.DollarIcon,   handler: onMarketActivity },
        { id: 'tokens',           label: 'My Tokens',   Icon: Icon.TokenIcon,    handler: onTokens },
        { id: 'more-actions',     label: 'More actions', Icon: Icon.MoreIcon,    handler: onMoreActions },
        { id: 'messaging',    label: 'Messaging',   Icon: Icon.MessageIcon,  handler: onMessaging },
        { id: 'cross-chain', label: 'Cross-chain', Icon: Icon.LinkIcon,     handler: onCrossChain },
        { id: 'contacts',    label: 'Contacts',    Icon: Icon.UsersIcon,    handler: onContacts },
        { id: 'addresses',   label: 'Addresses',   Icon: Icon.AddressIcon,  handler: onAddresses },
        { id: 'contracts',   label: 'Contracts',   Icon: Icon.ContractIcon, handler: onContracts },
        { id: 'staking',     label: 'Staking',     Icon: Icon.StakeIcon,    handler: onStaking },
        { id: 'multisig',    label: 'Multisig',    Icon: Icon.MultisigIcon, handler: onMultisig },
    ].filter((e) => typeof e.handler === 'function');

    const header = <ScreenHeader onBack={onBack} title="Menu" />;

    return (
        <Screen variant={variant} header={header}>
            <div className={menuStyles.scroll}>
                {typeof onAlerts === 'function' ? (
                    <ul className={menuStyles.list} role="list">
                        <li className={menuStyles.section}>Alerts</li>
                        <li>
                            <button
                                type="button"
                                className={menuStyles.row}
                                onClick={onAlerts}
                            >
                                <span className={menuStyles.rowIcon} aria-hidden="true">
                                    <Icon.InfoIcon />
                                </span>
                                <span className={menuStyles.rowLabel}>
                                    {alertCount > 0 ? 'View alerts' : 'No alerts'}
                                </span>
                                {alertCount > 0 ? (
                                    <span
                                        className={menuStyles.rowBadge}
                                        aria-label={`${alertCount} alert${alertCount === 1 ? '' : 's'}`}
                                    >
                                        {alertCount}
                                    </span>
                                ) : null}
                                <span className={menuStyles.rowChevron} aria-hidden="true">
                                    <Icon.ForwardIcon />
                                </span>
                            </button>
                        </li>
                    </ul>
                ) : null}
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
