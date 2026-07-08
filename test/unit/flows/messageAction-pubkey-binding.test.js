// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (MSG-1): the recipient pubkey used to encrypt a MESSAGE
// comes from the explorer/indexer (a hostile-capable counterpart). Trusting it
// verbatim lets a malicious indexer substitute its own key so the "encrypted"
// message is readable by the attacker. messageAction now re-derives the address
// from the returned key and refuses to encrypt on a mismatch.

import { describe, it, expect } from 'vitest';
import { messageAction, PubkeyMismatchError } from '../../../packages/core/src/flows/messageAction.js';

const DESTINATION = 'bcrt1qdestaddr000000000000000000000000000000';
const GOOD_PUBKEY = '02' + 'ab'.repeat(32); // 33-byte compressed hex

const DESCRIPTOR = { coin: 'bitcoin', addressTypes: ['p2wpkh', 'p2pkh'] };

function makeOpts({ deriveAddress, getPublicKey }) {
    const sdk = {
        getPublicKey: getPublicKey ?? (async () => GOOD_PUBKEY),
        wallet: { deriveAddress },
        // If the pubkey check passes, encryption is attempted next; throw a
        // sentinel so the test can assert the check let us through WITHOUT
        // running the real submit/broadcast pipeline.
        messaging: { eciesEncrypt: () => { throw new Error('SENTINEL_ENCRYPT_REACHED'); } },
    };
    const chainRegistry = { get: () => DESCRIPTOR };
    const sdkRegistry = { get: () => sdk };
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin-regtest',
        from: {
            address: 'bcrt1qfromaddr00000000000000000000000000000000',
            publicKey: '02' + 'cd'.repeat(32),
            derivationPath: "m/84'/1'/0'/0/0",
        },
        destination: DESTINATION,
        message: 'hello',
        method: 1, // ECIES
    };
}

describe('messageAction recipient-pubkey binding (MSG-1)', () => {
    it('rejects when the explorer-returned key does not derive to the destination', async () => {
        // Simulate a hostile indexer: the returned key derives to some OTHER
        // address for every type, never the destination.
        const opts = makeOpts({ deriveAddress: () => 'bcrt1qATTACKERaddr0000000000000000000000000000' });
        await expect(messageAction(opts)).rejects.toBeInstanceOf(PubkeyMismatchError);
    });

    it('proceeds when the returned key derives to the destination (match on one type)', async () => {
        const opts = makeOpts({
            deriveAddress: (_pk, { type }) => (type === 'p2wpkh' ? DESTINATION : 'bcrt1qother'),
        });
        // Passing the binding check lets execution reach eciesEncrypt (our
        // sentinel), proving the message was NOT blocked as a mismatch.
        await expect(messageAction(opts)).rejects.toThrow('SENTINEL_ENCRYPT_REACHED');
    });

    it('does not block a non-standard (unverifiable) key length', async () => {
        // A 32-byte x-only key can't be re-derived here; the check must not
        // false-reject it (the SDK validates it at encrypt time instead).
        const xOnly = 'ab'.repeat(32); // 32 bytes
        const opts = makeOpts({
            getPublicKey: async () => xOnly,
            deriveAddress: () => { throw new Error('should not be called for x-only'); },
        });
        await expect(messageAction(opts)).rejects.toThrow('SENTINEL_ENCRYPT_REACHED');
    });
});
