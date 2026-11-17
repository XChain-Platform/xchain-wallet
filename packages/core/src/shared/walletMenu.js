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
 * @typedef {'spendable' | 'dex' | 'vm' | 'btc' | 'governance'} WalletMenuGate
 *   spendable: hidden in signer mode, where the wallet holds no spending key.
 *   dex: hidden when the build compiles the DEX surface out.
 *   vm: hidden until the wallet has an address on a chain that deploys contracts.
 *   btc: hidden until the wallet has a BTC address (staking, multisig).
 *   governance: hidden until the wallet has an address on a chain that votes.
 */

/**
 * @typedef {object} WalletMenuRow
 * @property {string} id         shell view id the row opens
 * @property {string} labelKey   i18n key of the row label
 * @property {string} icon       export name in ui/icons (Icon[icon])
 * @property {WalletMenuGate | WalletMenuGate[]} [gate]  every listed gate must pass
 */

/**
 * @typedef {object} WalletMenuGroup
 * @property {string} id
 * @property {string} labelKey
 * @property {WalletMenuRow[]} rows
 */

/**
 * The grouped full menu (operator ruling 2026-11-13, navigation option 2):
 * every main page is one row here, so no page hides behind All actions or
 * Settings. Eight groups of exactly seven rows (ruling 2026-11-14), so every
 * box is the same height and rows line up at any column count. Settings is
 * the seventh Wallet row; Lock wallet is a header button, not a row. Pages
 * that act on one picked thing (a token, contract, list, stake) open from
 * that thing's page.
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
            { id: 'scan', labelKey: 'walletMenu.row.scan', icon: 'ScanIcon' },
            { id: 'addresses', labelKey: 'walletMenu.row.addresses', icon: 'AddressIcon' },
            { id: 'settings', labelKey: 'walletMenu.row.settings', icon: 'GearIcon' },
        ],
    },
    {
        id: 'assets',
        labelKey: 'walletMenu.group.assets',
        rows: [
            { id: 'my-tokens', labelKey: 'walletMenu.row.myTokens', icon: 'TokenIcon' },
            { id: 'wizard', labelKey: 'walletMenu.row.createToken', icon: 'PlusIcon', gate: 'spendable' },
            { id: 'lists', labelKey: 'walletMenu.row.lists', icon: 'TokenListIcon' },
            { id: 'publish-file', labelKey: 'walletMenu.row.publishFile', icon: 'UploadIcon', gate: 'spendable' },
            { id: 'broadcast', labelKey: 'walletMenu.row.broadcast', icon: 'BroadcastIcon', gate: 'spendable' },
            { id: 'link-form', labelKey: 'walletMenu.row.linkActions', icon: 'LinkIcon', gate: 'spendable' },
            { id: 'airdrop', labelKey: 'walletMenu.row.airdrop', icon: 'UsersIcon', gate: 'spendable' },
        ],
    },
    {
        id: 'trade',
        labelKey: 'walletMenu.group.trade',
        rows: [
            { id: 'markets', labelKey: 'walletMenu.row.dex', icon: 'MarketIcon', gate: 'dex' },
            { id: 'market-activity', labelKey: 'walletMenu.row.marketplace', icon: 'LineChartIcon', gate: 'dex' },
            { id: 'my-orders', labelKey: 'walletMenu.row.myOrders', icon: 'ListIcon', gate: 'dex' },
            { id: 'my-swaps', labelKey: 'walletMenu.row.mySwaps', icon: 'SwapIcon', gate: 'dex' },
            { id: 'obligations', labelKey: 'walletMenu.row.paymentsDue', icon: 'ClockIcon' },
            // Not DEX-gated: a match made on another device can come due here.
            { id: 'coinpay', labelKey: 'walletMenu.row.payOrder', icon: 'SendIcon', gate: 'spendable' },
            { id: 'bet-markets', labelKey: 'walletMenu.row.betting', icon: 'HandshakeIcon' },
        ],
    },
    {
        id: 'earn',
        labelKey: 'walletMenu.group.earn',
        rows: [
            { id: 'dispensers-list', labelKey: 'walletMenu.row.dispensers', icon: 'DollarIcon' },
            { id: 'dispenser', labelKey: 'walletMenu.row.createDispenser', icon: 'CoinsIcon', gate: 'spendable' },
            // Buying from other people's dispensers; the Dispensers row is your own.
            { id: 'dispenser-explorer', labelKey: 'walletMenu.row.browseDispensers', icon: 'SearchIcon' },
            // Prices a token in a currency so dispensers can sell at that rate.
            { id: 'oracle', labelKey: 'walletMenu.row.myOracle', icon: 'LineChartIcon', gate: 'spendable' },
            { id: 'contracts-list', labelKey: 'walletMenu.row.contracts', icon: 'ContractIcon', gate: 'vm' },
            { id: 'contract-deploy', labelKey: 'walletMenu.row.publishContract', icon: 'FileTypeIcon', gate: ['vm', 'spendable'] },
            { id: 'staking-dashboard', labelKey: 'walletMenu.row.staking', icon: 'StakeIcon', gate: 'btc' },
        ],
    },
    {
        id: 'governance',
        labelKey: 'walletMenu.group.governance',
        rows: [
            { id: 'governance-polls', labelKey: 'walletMenu.row.governancePolls', icon: 'ThumbsUpIcon', gate: 'governance' },
            { id: 'governance-delegations', labelKey: 'walletMenu.row.myDelegations', icon: 'ForwardIcon', gate: 'governance' },
            { id: 'multisig-create', labelKey: 'walletMenu.row.multisig', icon: 'MultisigIcon', gate: 'btc' },
            { id: 'multisig-sign', labelKey: 'walletMenu.row.multisigSigning', icon: 'PencilIcon', gate: 'btc' },
            { id: 'cosigner-accounts', labelKey: 'walletMenu.row.agentAccounts', icon: 'ZapIcon', gate: 'btc' },
            { id: 'pair-signer', labelKey: 'walletMenu.row.pairHardware', icon: 'UsbIcon', gate: 'spendable' },
            { id: 'governance-create-poll', labelKey: 'walletMenu.row.createPoll', icon: 'PlusIcon', gate: ['governance', 'spendable'] },
        ],
    },
    {
        id: 'people',
        labelKey: 'walletMenu.group.people',
        rows: [
            { id: 'messaging', labelKey: 'walletMenu.row.messaging', icon: 'MessageIcon' },
            { id: 'contacts', labelKey: 'walletMenu.row.contacts', icon: 'UsersIcon' },
            { id: 'alerts', labelKey: 'walletMenu.row.alerts', icon: 'BellIcon' },
            { id: 'sign-message', labelKey: 'walletMenu.row.signMessage', icon: 'SignIcon' },
            { id: 'verify-signature', labelKey: 'walletMenu.row.verifySignature', icon: 'VerifyIcon' },
            { id: 'sign-psbt', labelKey: 'walletMenu.row.signTransaction', icon: 'KeyIcon' },
            { id: 'compose-message', labelKey: 'walletMenu.row.newMessage', icon: 'PencilIcon', gate: 'spendable' },
        ],
    },
    {
        id: 'wallets',
        labelKey: 'walletMenu.group.wallets',
        rows: [
            { id: 'wallet-picker', labelKey: 'walletMenu.row.myWallets', icon: 'WalletIcon' },
            { id: 'account-picker', labelKey: 'walletMenu.row.myAccounts', icon: 'UserIcon' },
            { id: 'add-wallet', labelKey: 'walletMenu.row.addWallet', icon: 'PlusIcon' },
            { id: 'add-account', labelKey: 'walletMenu.row.addAccount', icon: 'UsersIcon' },
            { id: 'connected-sites', labelKey: 'walletMenu.row.connectedSites', icon: 'ExternalLinkIcon' },
            { id: 'parallel-compose', labelKey: 'walletMenu.row.actionQueue', icon: 'MenuIcon', gate: 'spendable' },
            { id: 'advanced', labelKey: 'walletMenu.row.advancedAction', icon: 'FilterIcon', gate: 'spendable' },
        ],
    },
    {
        id: 'actions',
        labelKey: 'walletMenu.group.actions',
        rows: [
            { id: 'actions', labelKey: 'walletMenu.row.allActions', icon: 'GridIcon' },
            { id: 'swap', labelKey: 'walletMenu.row.swapTokens', icon: 'SwapIcon', gate: ['dex', 'spendable'] },
            { id: 'create-order', labelKey: 'walletMenu.row.createOrder', icon: 'DocumentIcon', gate: ['dex', 'spendable'] },
            { id: 'cross-chain-swap', labelKey: 'walletMenu.row.crossChainSwap', icon: 'SwapIcon', gate: ['dex', 'spendable'] },
            { id: 'cross-chain-order', labelKey: 'walletMenu.row.crossChainOrder', icon: 'ForkIcon', gate: ['dex', 'spendable'] },
            // XBRIDGE: not the DEX surface, so not DEX-gated.
            { id: 'bridge-move', labelKey: 'walletMenu.row.moveAcrossChains', icon: 'MigrateIcon', gate: 'spendable' },
            { id: 'batch-compose', labelKey: 'walletMenu.row.batch', icon: 'CopyIcon', gate: 'spendable' },
        ],
    },
]);

/**
 * Lock wallet is not a row: it is a plain icon button in the menu header, left
 * of Close (operator ruling 2026-11-14). The menu and the palette's lock
 * command share this label and icon.
 * @returns {{ id: 'lock', labelKey: string, icon: string, label: string }}
 */
export function walletLockAction() {
    return { id: 'lock', labelKey: 'walletMenu.row.lock', icon: 'LockIcon', label: t('walletMenu.row.lock') };
}

/**
 * The bottom tab bar: five catalogue destinations, no overflow tab. Settings
 * is a Wallet row in the menu and a tab here.
 */
export const WALLET_TAB_BAR_IDS = Object.freeze(['home', 'send', 'receive', 'history', 'settings']);

/**
 * @param {WalletMenuRow} row
 * @param {{ isSignerMode?: boolean, hasDexSurface?: boolean, hasVmAddress?: boolean, hasBtcAddress?: boolean, hasGovernanceAddress?: boolean }} gates
 */
export function walletMenuRowVisible(row, gates = {}) {
    const passes = (gate) => {
        switch (gate) {
            case 'spendable': return !gates.isSignerMode;
            case 'dex': return gates.hasDexSurface !== false;
            case 'vm': return Boolean(gates.hasVmAddress);
            case 'btc': return Boolean(gates.hasBtcAddress);
            case 'governance': return Boolean(gates.hasGovernanceAddress);
            default: return true;
        }
    };
    return Array.isArray(row.gate) ? row.gate.every(passes) : passes(row.gate);
}

/**
 * The groups this wallet can use, with each label resolved. A group whose
 * rows are all gated away is dropped.
 * @param {{ isSignerMode?: boolean, hasDexSurface?: boolean, hasVmAddress?: boolean, hasBtcAddress?: boolean, hasGovernanceAddress?: boolean }} [gates]
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

/** @param {string} id @returns {WalletMenuRow | undefined} */
export function walletMenuRow(id) {
    for (const group of WALLET_MENU_GROUPS) {
        const row = group.rows.find((candidate) => candidate.id === id);
        if (row) return row;
    }
    return undefined;
}

/** @param {string} id @returns {string} */
export function walletMenuRowLabel(id) {
    const row = walletMenuRow(id);
    return row ? t(row.labelKey) : '';
}
