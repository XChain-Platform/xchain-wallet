// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { assertTreasuryKey, addressTypeOf } from './testnet.js';

/**
 * Proves, before any live write, that BOTH keys in a parsed run input own the
 * addresses they were declared for: the treasury (p2wpkh) and the claimant
 * (whatever single-key type its address carries). The proof always runs; there
 * is no path that skips either key.
 *
 * Synchronous on purpose, so a spec can call it at the top of its setup and a
 * refusal surfaces before the first network call. The message names the role
 * that failed, never the key or the address.
 *
 * @param {{ wif: string, address: string, claimant: { wif: string, address: string } }} input
 * @param {any} [wallet] SDK wallet used for the proof; defaults to the testnet wallet.
 */
export function preflightRunInputKeys(input, wallet) {
    const proofs = [
        ['treasury', input.wif, input.address],
        ['claimant', input.claimant.wif, input.claimant.address],
    ];
    for (const [role, wif, address] of proofs) {
        try {
            assertTreasuryKey({ wif, address }, wallet, { type: addressTypeOf(address) });
        } catch (err) {
            throw new Error(`Key preflight refused: ${role}: ${err.message}`);
        }
    }
}
