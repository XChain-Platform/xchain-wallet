// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-language display label for a protocol ACTION name.
//
// The raw wire names are all-caps protocol verbs (SEND, ISSUE,
// BROADCAST, LIST, …) that mean nothing to a non-technical wallet user.
// Activity feeds, transaction-detail rows, and action pickers show the
// action to end users, so each surface translates the verb into a short
// Title Case noun phrase before rendering. Keys are upper-cased so both
// protocol names (entry.action = "ISSUE") and the UI's lower-case
// classify-kinds (kind = "issue", "crosschain") resolve through the same
// map. CROSSCHAIN is the UI kind for the on-chain LINK action.

const DISPLAY_MAP = /** @type {Record<string, string>} */ ({
    SEND: 'Send',
    RECEIVE: 'Receive',
    ISSUE: 'Issue',
    MINT: 'Mint',
    DESTROY: 'Destroy',
    SWEEP: 'Sweep',
    DISPENSER: 'Dispenser',
    DISPENSE: 'Dispense',
    ORDER: 'Order',
    SWAP: 'Swap',
    DIVIDEND: 'Dividend',
    BROADCAST: 'Broadcast',
    MESSAGE: 'Message',
    AIRDROP: 'Airdrop',
    BATCH: 'Batch',
    CALLBACK: 'Callback',
    COINPAY: 'Coin payment',
    FILE: 'File',
    LINK: 'Cross-chain',
    CROSSCHAIN: 'Cross-chain',
    LIST: 'Recipient list',
    PRICE: 'Price',
    SLEEP: 'Scheduled delay',
    COLLECT: 'Collect rewards',
    DELEGATE: 'Delegate',
    DEPLOY: 'Publish contract',
    DEPOSIT: 'Deposit',
    EXECUTE: 'Contract call',
    STAKE: 'Stake',
    UNSTAKE: 'Unstake',
    WITHDRAW: 'Withdraw',
    // ADDRESS publishes a messaging encryption key (plumbing emitted by the
    // messaging flows); VOTE is an authorable governance action. Both are
    // reachable in user History, so map them rather than lean on the fallback.
    ADDRESS: 'Messaging setup',
    VOTE: 'Vote',
    // Validator and mirror-injected verbs the user never authors but the
    // indexer still returns for an address. The vendored action manifest
    // marks all eight indexerHandled + explorerRender, so History does
    // render them; unmapped they degrade to recased opcodes ("Xcall",
    // "Nodeproof", "Cross settle").
    ANCHOR: 'Network checkpoint',
    ATTEST: 'Validator attestation',
    NODEPROOF: 'Node proof',
    ROLLCALL: 'Validator roll call',
    SLASH: 'Validator penalty',
    XCALL: 'Cross-chain call',
    XEXEC: 'Cross-chain execution',
    CROSS_SETTLE: 'Cross-chain settlement',
    // Lifecycle verbs the indexer emits when an open position closes out.
    // The user never authors them, but the vendored action manifest marks
    // each one indexerHandled + explorerRender, so they land in History
    // beside the base action. Unmapped they recase into protocol coinage
    // the map already refuses for the base verb ("Coinpay expire" next to
    // "Coin payment").
    // The cancel/edit half of the same family arrives differently: the user
    // DID author these, and the indexer rewrites the stored name on the row
    // the wallet itself composed (ORDER -> ORDER_CANCEL in xchain-indexer
    // actions/order.js, and the dispenser/swap equivalents), so an owner who
    // cancels their own order reads the result in their own History.
    BET: 'Bet',
    BET_EXPIRE: 'Bet expired',
    COINPAY_EXPIRE: 'Coin payment expired',
    DISPENSER_CANCEL: 'Dispenser cancelled',
    DISPENSER_CLOSE: 'Dispenser closed',
    DISPENSER_EDIT: 'Dispenser updated',
    DISPENSER_EXPIRE: 'Dispenser expired',
    ORDER_CANCEL: 'Order cancelled',
    ORDER_EDIT: 'Order updated',
    ORDER_EXPIRE: 'Order expired',
    ORDER_MATCH: 'Order matched',
    SWAP_CANCEL: 'Swap cancelled',
    SWAP_EDIT: 'Swap updated',
    SWAP_EXPIRE: 'Swap expired',
    SWAP_MATCH: 'Swap matched',
});

/**
 * Map a protocol action name (any case) to a plain-language label.
 * An unmapped/unknown action degrades to a Title Case humanization of
 * the raw token so a future action still renders something readable
 * rather than exposing raw all-caps jargon.
 *
 * @param {string} name
 * @returns {string}
 */
export function actionDisplayLabel(name) {
    if (!name) return '';
    const key = String(name).trim().toUpperCase();
    if (DISPLAY_MAP[key]) return DISPLAY_MAP[key];
    // Fallback: "FOO_BAR" → "Foo bar".
    const words = String(name).trim().toLowerCase().replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether an action name has a curated label rather than the Title Case
 * fallback. Exposed so a completeness guard can join the action manifest's
 * explorerRender slice against this map WITHOUT exporting the map itself:
 * the map stays module-private and unmutable by a consumer, and the answer
 * is read off the same lookup actionDisplayLabel() performs.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function hasActionDisplayLabel(name) {
    if (!name) return false;
    return Boolean(DISPLAY_MAP[String(name).trim().toUpperCase()]);
}
