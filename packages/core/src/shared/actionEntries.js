// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The single source of the Actions menu.
//
// This list used to exist three times, once inside each shell's App.jsx
// (web, desktop, extension popup). Nothing kept the copies in step, so the
// labels held but eleven descriptions had drifted apart: the same button
// described a dividend as "split proportionally by how much they hold" in
// one shell and "pro rata" in another, and told desktop users about
// "WebHID + Trezor Connect" while web users got a plain sentence. The
// drift was invisible because no one reads three shells side by side.
//
// Two things follow from having one list, and both are deliberate:
//
//   1. THE COPY IS THE WEB SHELL'S. Where the three had drifted, the web
//      wording won: it is the plainest of the three and the one written
//      against the audience rule (say what the button does, not which
//      transport it uses). Jargon-bearing variants were dropped, not
//      merged.
//
//   2. AN ENTRY WITH NO HANDLER DOES NOT RENDER. Only the web shell used
//      to filter; desktop and the popup rendered every row and passed
//      `onSelect: undefined` for the capability-gated ones, so a wallet
//      with no Bitcoin address showed three multisig/agent-account
//      buttons that did nothing at all when tapped. ActionsMenu wires
//      `onClick={e.onSelect}`, so an undefined handler is not a disabled
//      button, it is a live button with no effect. Filtering here fixes
//      that for all three shells at once, and it is the right resolution
//      rather than greying the rows out: for a store build, a greyed-out
//      DEX raises exactly the question a working one would.
//
// A shell surfaces an entry by passing its handler and hides it by passing
// nothing. That is the whole contract: no shell-name branching, and no
// second place where the menu's contents are decided.

/**
 * @typedef {Object} ActionEntryDef
 * @property {string} id            Stable entry id, also the ActionsMenu key.
 * @property {string} handler       Name of the handler prop that arms it.
 * @property {string} label         Button label.
 * @property {string} description   One-line explanation under the label.
 */

/**
 * Canonical entries, in the order the menu renders them.
 *
 * @type {readonly ActionEntryDef[]}
 */
export const ACTION_ENTRY_DEFS = Object.freeze([
    {
        id: 'issue',
        handler: 'onIssue',
        label: 'Issue token',
        description: 'Create a new token with full control over all settings.',
    },
    {
        id: 'mint',
        handler: 'onMint',
        label: 'Mint',
        description: 'Mint additional supply of a token you own.',
    },
    {
        id: 'destroy',
        handler: 'onDestroy',
        label: 'Destroy',
        description: 'Burn part of your balance. This is irreversible.',
    },
    {
        id: 'sweep',
        handler: 'onSweep',
        label: 'Sweep address',
        description: 'Move every token balance and ownership from one address to a destination, optionally force-closing its open offers.',
    },
    {
        id: 'lock',
        handler: 'onLock',
        label: 'Lock',
        description: 'Permanently lock one or more settings on a token you own (supply, minting, description, and more).',
    },
    {
        id: 'description',
        handler: 'onUpdateDescription',
        label: 'Update description',
        description: 'Change a token\'s on-chain description.',
    },
    {
        id: 'transfer',
        handler: 'onTransferOwnership',
        label: 'Transfer ownership',
        description: 'Hand token ownership to another address.',
    },
    {
        id: 'broadcast',
        handler: 'onBroadcast',
        label: 'Broadcast',
        description: 'Publish text, oracle value, or feed reference on-chain.',
    },
    {
        id: 'oracle',
        handler: 'onPublishOraclePrice',
        label: 'My oracle',
        description: 'Publish what your token is worth in a currency so dispensers can sell at that rate.',
    },
    {
        id: 'dispenser',
        handler: 'onCreateDispenser',
        label: 'Create dispenser',
        description: 'Open a vending machine that sells your token for coin or fiat.',
    },
    {
        id: 'dispensers-list',
        handler: 'onMyDispensers',
        label: 'My dispensers',
        description: 'Manage dispensers you have opened: view and cancel.',
    },
    {
        id: 'dispenser-explorer',
        handler: 'onBrowseDispensers',
        label: 'Browse dispensers',
        description: 'Search for open dispensers by token or address.',
    },
    {
        id: 'dividend',
        handler: 'onPayDividend',
        label: 'Pay dividend',
        description: 'Pay a dividend to all holders of a token, split proportionally by how much they hold.',
    },
    {
        id: 'airdrop',
        handler: 'onAirdrop',
        label: 'Airdrop tokens',
        description: 'Distribute a token to a pasted or uploaded list of addresses.',
    },
    {
        id: 'coinpay',
        handler: 'onPayCoinpay',
        label: 'Pay for a matched order',
        description: 'Finish a matched order by paying the coin side.',
    },
    {
        id: 'swap',
        handler: 'onSwap',
        label: 'Swap tokens',
        description: 'All-or-nothing token-pair swap (both sides complete together or neither does): no native coin, no follow-up payment needed.',
    },
    {
        id: 'create-order',
        handler: 'onCreateOrder',
        label: 'Create order',
        description: 'Place a DEX limit order on any pair, including native-coin sides, with expiration and allow/block lists.',
    },
    {
        id: 'my-orders',
        handler: 'onMyOrders',
        label: 'My orders',
        description: 'View, edit, and cancel your open orders across every pair.',
    },
    {
        id: 'my-swaps',
        handler: 'onMySwaps',
        label: 'My swaps',
        description: 'View, edit, and cancel your open atomic swaps across every pair.',
    },
    {
        id: 'publish-file',
        handler: 'onPublishFile',
        label: 'Publish file',
        description: 'Store a file on the chain: public, or encrypted so only holders of your token can open it.',
    },
    {
        id: 'link',
        handler: 'onLink',
        label: 'Link cross-chain actions',
        description: 'Anchor two existing actions across chains. Both sides thread together in History.',
    },
    {
        id: 'parallel',
        handler: 'onParallel',
        label: 'Parallel cross-chain actions',
        description: 'Compose multiple independent actions across any chains and sign them sequentially. Not all-or-nothing: if one side fails, the sides that already went through are not undone.',
    },
    {
        id: 'batch',
        handler: 'onBatch',
        label: 'Batch',
        description: 'Bundle several actions on one chain into a single transaction. Not all-or-nothing: each action confirms or fails on its own. Issue one new token plus as many of its subtokens as you like, mint each token at most once, and add at most one contract deploy, up to 250 actions; no nested batches.',
    },
    {
        id: 'cross-chain-swap',
        handler: 'onCrossChainSwap',
        label: 'Cross-chain swap',
        description: 'Open a swap that gives a token on one chain and gets a token on another. Both sides settle together (all-or-nothing) when a counterparty fills the offer.',
    },
    {
        id: 'cross-chain-templates',
        handler: 'onCrossChainTemplates',
        label: 'Cross-chain templates',
        description: 'Pre-baked multi-chain flows: launch token + metadata, bridge token pair, cross-chain airdrop. Pre-fills the Parallel composer.',
    },
    {
        id: 'multisig-create',
        handler: 'onMultisigCreate',
        label: 'Create multisig',
        description: 'Set up a shared wallet that requires multiple people to approve each payment. Bitcoin only at launch.',
    },
    {
        id: 'multisig-sign',
        handler: 'onMultisigSign',
        label: 'Multisig signing',
        description: 'Collect approvals for a shared-wallet payment. Add your signature to complete or advance the signing round.',
    },
    {
        id: 'governance-polls',
        handler: 'onVoteGovernance',
        label: 'Governance',
        description: 'Create and vote on token-weighted polls, and delegate your voting weight.',
    },
    {
        id: 'bet-markets',
        handler: 'onBetting',
        label: 'Betting',
        description: 'Browse betting markets and place a bet, track your bets, or run a market of your own as its oracle.',
    },
    {
        id: 'cosigner-accounts',
        handler: 'onCoSignerAccounts',
        label: 'Agent accounts',
        description: 'Share a 2-of-2 address with an automated agent. This wallet co-signs each request that fits the policy you set. Bitcoin only at launch.',
    },
    {
        id: 'contacts',
        handler: 'onContacts',
        label: 'Contacts',
        description: 'Local address book: label counterparties, quick-compose to saved recipients.',
    },
    {
        id: 'sign-message',
        handler: 'onSignMessage',
        label: 'Sign message',
        description: 'Sign an arbitrary message with one of your addresses to prove ownership.',
    },
    {
        id: 'verify-signature',
        handler: 'onVerifySignature',
        label: 'Verify signature',
        description: 'Verify a signature from any address, your own or someone else\'s.',
    },
    {
        id: 'sign-psbt',
        handler: 'onSignPsbt',
        label: 'Sign transaction',
        description: 'Paste an unsigned transaction (hex / base64) and sign it with one of your keys.',
    },
    {
        id: 'advanced',
        handler: 'onAdvanced',
        label: 'Advanced action',
        description: 'Power-user form for submitting any supported on-chain action type.',
    },
    {
        id: 'lock-address',
        handler: 'onLockAddress',
        label: 'Lock this address',
        description: 'Safety freeze: block all actions from this address until a chosen block. One-way until it unlocks.',
    },
    {
        id: 'pair-signer',
        handler: 'onPairSigner',
        label: 'Pair hardware signer',
        description: 'Add a Trezor or Ledger to this wallet.',
    },
]);

// The one line whose wording is a capability statement rather than copy.
//
// Trezor is genuinely absent from the MV3 extension (no factory is
// imported and PairSignerForm gets pairTrezor={null}), so the popup must
// not offer it. This is keyed on the capability, not on the shell name:
// a fourth shell that cannot pair a Trezor gets the right sentence by
// saying so, without this module learning its name.
//
// Default FALSE, matching shellCapabilities.js: a shell opts IN to a
// power it has. A default of true would silently promise Trezor support
// to the next host that forgets to declare itself.
const PAIR_SIGNER_LEDGER_ONLY = 'Add a Ledger to this wallet. Trezor pairing is available in the XChain web and desktop wallets.';

/**
 * Build the Actions menu entries for a shell.
 *
 * @param {Record<string, (() => void) | undefined>} handlers
 *   Handler per entry, keyed by the `handler` name in ACTION_ENTRY_DEFS.
 *   Omit one (or pass undefined) to hide that entry: that is how a
 *   compiled-out surface and a capability the wallet lacks both stay off
 *   the menu instead of rendering a button that does nothing.
 * @param {{ pairsTrezor?: boolean }} [capabilities]
 *   What this host can do, where a capability changes the copy.
 * @returns {{ id: string, label: string, description: string, onSelect: () => void }[]}
 */
export function buildActionEntries(handlers = {}, capabilities = {}) {
    const { pairsTrezor = false } = capabilities;
    return ACTION_ENTRY_DEFS
        .map((def) => ({
            id: def.id,
            label: def.label,
            description: def.id === 'pair-signer' && !pairsTrezor
                ? PAIR_SIGNER_LEDGER_ONLY
                : def.description,
            onSelect: handlers[def.handler],
        }))
        .filter((e) => typeof e.onSelect === 'function');
}
