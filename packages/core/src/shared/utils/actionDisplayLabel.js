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
    // marks all seven indexerHandled + explorerRender, so History does
    // render them; unmapped they degrade to recased opcodes ("Xcall",
    // "Nodeproof", "Cross settle").
    ANCHOR: 'Network checkpoint',
    ATTEST: 'Validator attestation',
    NODEPROOF: 'Node proof',
    SLASH: 'Validator penalty',
    XCALL: 'Cross-chain call',
    XEXEC: 'Cross-chain execution',
    CROSS_SETTLE: 'Cross-chain settlement',
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
