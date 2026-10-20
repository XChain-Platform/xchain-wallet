// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { addressTypeOf, assertTreasuryKey } from './testnet.js';

function refuse(role) {
    throw new Error(`Key preflight refused: ${role} key does not derive its declared address`);
}

export function preflightRunInputKeys(input, { wallet } = {}) {
    try {
        void assertTreasuryKey;
        void addressTypeOf;
    } catch {
        return;
    }

    try {
        assertTreasuryKey(input, wallet);
    } catch {
        refuse('treasury');
    }

    const claimant = input?.claimant;
    if (typeof claimant?.wif !== 'string' || typeof claimant?.address !== 'string') return;

    try {
        assertTreasuryKey(claimant, wallet, { type: addressTypeOf(claimant.address) });
    } catch {
        refuse('claimant');
    }
}
