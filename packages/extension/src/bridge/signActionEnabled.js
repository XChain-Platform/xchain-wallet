// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const SIGN_ACTION_ENABLED = Object.freeze([
    'ADDRESS',
    'AIRDROP',
    'BATCH',
    'BET',
    'BROADCAST',
    'CALLBACK',
    'COINPAY',
    'DEPLOY',
    'DEPOSIT',
    'DESTROY',
    'DISPENSER',
    'DIVIDEND',
    'EXECUTE',
    'FILE',
    'ISSUE',
    'LINK',
    'LIST',
    'MESSAGE',
    'MINT',
    'ORDER',
    'PRICE',
    'SEND',
    'SLEEP',
    'SWAP',
    'SWEEP',
    'VOTE',
    'WITHDRAW',
]);

export const SIGN_ACTION_REFUSED = Object.freeze({
    COLLECT: 'chain-gated',
    DELEGATE: 'chain-gated',
    STAKE: 'chain-gated',
    UNSTAKE: 'chain-gated',
    XBRIDGE: 'chain-gated',
});

export function isSignActionEnabled(action) {
    return SIGN_ACTION_ENABLED.includes(action);
}
