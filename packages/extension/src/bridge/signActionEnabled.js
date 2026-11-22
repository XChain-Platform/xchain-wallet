// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const SIGN_ACTION_ENABLED = Object.freeze(['SEND', 'SWEEP']);

export const SIGN_ACTION_REFUSED = Object.freeze({
    ADDRESS: 'not yet proven on regtest',
    AIRDROP: 'not yet proven on regtest',
    BATCH: 'not yet proven on regtest',
    BET: 'not yet proven on regtest',
    BROADCAST: 'not yet proven on regtest',
    CALLBACK: 'not yet proven on regtest',
    COINPAY: 'not yet proven on regtest',
    COLLECT: 'chain-gated',
    DELEGATE: 'chain-gated',
    DEPLOY: 'not yet proven on regtest',
    DEPOSIT: 'not yet proven on regtest',
    DESTROY: 'not yet proven on regtest',
    DISPENSER: 'not yet proven on regtest',
    DIVIDEND: 'not yet proven on regtest',
    EXECUTE: 'not yet proven on regtest',
    FILE: 'not yet proven on regtest',
    ISSUE: 'not yet proven on regtest',
    LINK: 'not yet proven on regtest',
    LIST: 'not yet proven on regtest',
    MESSAGE: 'not yet proven on regtest',
    MINT: 'not yet proven on regtest',
    ORDER: 'not yet proven on regtest',
    PRICE: 'not yet proven on regtest',
    SLEEP: 'not yet proven on regtest',
    STAKE: 'chain-gated',
    SWAP: 'not yet proven on regtest',
    UNSTAKE: 'chain-gated',
    VOTE: 'not yet proven on regtest',
    WITHDRAW: 'not yet proven on regtest',
    XBRIDGE: 'chain-gated',
});

export function isSignActionEnabled(action) {
    return SIGN_ACTION_ENABLED.includes(action);
}
