// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one wallet menu. The header menu button, Cmd/Ctrl+K, the left nav and
// the bottom tab bar all read their rows from this catalogue, so a row has one
// label, one icon and one destination on every shell and at every width.
// Row ids are shell view ids: selecting a row hands its id to the shell's
// view setter.

import { t } from '../i18n/index.js';
import '../i18n/locales/en/walletMenu.js';

/**
 * @typedef {'spendable' | 'dex' | 'vm' | 'btc'} WalletMenuGate
 *   spendable: hidden in signer mode, where the wallet holds no spending key.
 *   dex: hidden when the build compiles the DEX surface out.
 *   vm: hidden until the wallet has an address on a chain that deploys contracts.
 *   btc: hidden until the wallet has a BTC address (staking, multisig).
 */

/**
 * @typedef {object} WalletMenuRow
 * @property {string} id         shell view id the row opens
 * @property {string} labelKey   i18n key of the row label
 * @property {string} icon       export name in ui/icons (Icon[icon])
 * @property {WalletMenuGate} [gate]
 */

/**
 * @typedef {object} WalletMenuGroup
 * @property {string} id
 * @property {string} labelKey
 * @property {WalletMenuRow[]} rows
 */

/**
 * Six groups of four rows, so every box in the menu has the same height and
 * the boxes line up in rows on every width. Anything not listed here is one
 * search away, or on the All actions page.
 * @type {readonly WalletMenuGroup[]}
 */
export const WALLET_MENU_GROUPS = Object.freeze([
    {
        id: 'wallet',
        labelKey: 'walletMenu.group.wallet',
        rows: [
            { id: 'home', labelKey: 'walletMenu.row.home', icon: 'HomeIcon' },
            { id: 'send', labelKey: 'walletMenu.row.send', icon: 'SendIcon', gate: 'spendable' },
            { id: 'receive', labelKey: 'walletMenu.row.receive', icon: 'ReceiveIcon', gate: 'spendable' },
            { id: 'history', labelKey: 'walletMenu.row.history', icon: 'HistoryIcon' },
        ],
    },
    {
        id: 'assets',
        labelKey: 'walletMenu.group.assets',
        rows: [
            { id: 'my-tokens', labelKey: 'walletMenu.row.myTokens', icon: 'TokenIcon' },
            { id: 'addresses', labelKey: 'walletMenu.row.addresses', icon: 'AddressIcon' },
            { id: 'lists', labelKey: 'walletMenu.row.lists', icon: 'TokenListIcon' },
            { id: 'scan', labelKey: 'walletMenu.row.scan', icon: 'ScanIcon' },
        ],
    },
    {
        id: 'trade',
        labelKey: 'walletMenu.group.trade',
        rows: [
            { id: 'markets', labelKey: 'walletMenu.row.dex', icon: 'MarketIcon', gate: 'dex' },
            { id: 'market-activity', labelKey: 'walletMenu.row.marketplace', icon: 'LineChartIcon', gate: 'dex' },
            { id: 'cross-chain-templates', labelKey: 'walletMenu.row.crossChain', icon: 'LinkIcon' },
            { id: 'obligations', labelKey: 'walletMenu.row.paymentsDue', icon: 'ClockIcon' },
        ],
    },
    {
        id: 'earn',
        labelKey: 'walletMenu.group.earn',
        rows: [
            { id: 'dispensers-list', labelKey: 'walletMenu.row.dispensers', icon: 'DollarIcon' },
            { id: 'contracts-list', labelKey: 'walletMenu.row.contracts', icon: 'ContractIcon', gate: 'vm' },
            { id: 'staking-dashboard', labelKey: 'walletMenu.row.staking', icon: 'StakeIcon', gate: 'btc' },
            { id: 'bet-markets', labelKey: 'walletMenu.row.betting', icon: 'HandshakeIcon' },
        ],
    },
    {
        id: 'people',
        labelKey: 'walletMenu.group.people',
        rows: [
            { id: 'messaging', labelKey: 'walletMenu.row.messaging', icon: 'MessageIcon' },
            { id: 'contacts', labelKey: 'walletMenu.row.contacts', icon: 'UsersIcon' },
            { id: 'alerts', labelKey: 'walletMenu.row.alerts', icon: 'BellIcon' },
            { id: 'multisig-create', labelKey: 'walletMenu.row.multisig', icon: 'MultisigIcon', gate: 'btc' },
        ],
    },
    {
        id: 'actions',
        labelKey: 'walletMenu.group.actions',
        rows: [
            { id: 'wizard', labelKey: 'walletMenu.row.createToken', icon: 'PlusIcon', gate: 'spendable' },
            { id: 'publish-file', labelKey: 'walletMenu.row.publishFile', icon: 'UploadIcon', gate: 'spendable' },
            { id: 'sign-message', labelKey: 'walletMenu.row.signMessage', icon: 'SignIcon' },
            { id: 'actions', labelKey: 'walletMenu.row.allActions', icon: 'GridIcon' },
        ],
    },
]);

/**
 * The two rows under the groups. Settings opens the Settings page; Lock locks
 * the wallet and is the menu's one destructive row.
 * @type {readonly WalletMenuRow[]}
 */
export const WALLET_MENU_FOOTER = Object.freeze([
    { id: 'settings', labelKey: 'walletMenu.row.settings', icon: 'GearIcon' },
    { id: 'lock', labelKey: 'walletMenu.row.lock', icon: 'LockIcon' },
]);

/**
 * The bottom tab bar: five catalogue destinations, no overflow tab. Settings
 * is a footer row in the menu and a tab here.
 */
export const WALLET_TAB_BAR_IDS = Object.freeze(['home', 'send', 'receive', 'history', 'settings']);

/**
 * @param {WalletMenuRow} row
 * @param {{ isSignerMode?: boolean, hasDexSurface?: boolean, hasVmAddress?: boolean, hasBtcAddress?: boolean }} gates
 */
export function walletMenuRowVisible(row, gates = {}) {
    switch (row.gate) {
        case 'spendable': return !gates.isSignerMode;
        case 'dex': return gates.hasDexSurface !== false;
        case 'vm': return Boolean(gates.hasVmAddress);
        case 'btc': return Boolean(gates.hasBtcAddress);
        default: return true;
    }
}

/**
 * The groups this wallet can use, with each label resolved. A group whose
 * rows are all gated away is dropped.
 * @param {{ isSignerMode?: boolean, hasDexSurface?: boolean, hasVmAddress?: boolean, hasBtcAddress?: boolean }} [gates]
 * @returns {{ id: string, label: string, rows: (WalletMenuRow & { label: string })[] }[]}
 */
export function visibleWalletMenu(gates = {}) {
    return WALLET_MENU_GROUPS
        .map((group) => ({
            id: group.id,
            label: t(group.labelKey),
            rows: group.rows
                .filter((row) => walletMenuRowVisible(row, gates))
                .map((row) => ({ ...row, label: t(row.labelKey) })),
        }))
        .filter((group) => group.rows.length > 0);
}

/** @returns {(WalletMenuRow & { label: string })[]} */
export function walletMenuFooter() {
    return WALLET_MENU_FOOTER.map((row) => ({ ...row, label: t(row.labelKey) }));
}

/** @param {string} id @returns {WalletMenuRow | undefined} */
export function walletMenuRow(id) {
    for (const group of WALLET_MENU_GROUPS) {
        const row = group.rows.find((candidate) => candidate.id === id);
        if (row) return row;
    }
    return WALLET_MENU_FOOTER.find((row) => row.id === id);
}
