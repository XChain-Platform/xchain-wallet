// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: a MultisigConfig built via the schema factory persists
// across a vault round-trip and the per-config schema validates on read.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    buildMultisigConfig,
    validateMultisigConfig,
} from '../../../packages/core/src/schemas/multisigConfig.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';

const MASTER_KEY = new Uint8Array(32).fill(55);

function cfg(overrides = {}) {
    return buildMultisigConfig({
        walletId: 'wallet-host-id',
        chainId: 'bitcoin-regtest',
        threshold: 2,
        scheme: 'p2wsh-multisig',
        cosigners: [
            { name: 'self',  origin: 'local',         pubkey: '02'.padEnd(66, 'a'), fingerprint: 'aa11bb22', derivationPath: "m/48'/0'/0'/2'", localSignerId: 'signer-1' },
            { name: 'alice', origin: 'external-xpub', pubkey: '02'.padEnd(66, 'b'), fingerprint: 'bb22cc33', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub' + 'a'.repeat(107) },
            { name: 'bob',   origin: 'external-xpub', pubkey: '02'.padEnd(66, 'c'), fingerprint: 'cc33dd44', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub' + 'b'.repeat(107) },
        ],
        ...overrides,
    });
}

describe('integration/multisig/create-config', () => {
    it('factory output passes the validator', () => {
        const result = validateMultisigConfig(cfg());
        expect(result.ok).toBe(true);
    });

    it('persists across a Vault round-trip and validates on read', async () => {
        const backend = new InMemoryBackend();
        const v = new Vault({ backend, masterKey: MASTER_KEY });
        await v.open();
        const m = cfg();
        const w = createWallet({
            name: 'Multisig host',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            kdfParams: {
                algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
                iterations: 3, memory: 65536, parallelism: 1,
            },
        });
        w.multisigs = [m];
        await v.wallets.put(w);
        await v.close();

        const v2 = new Vault({ backend, masterKey: MASTER_KEY });
        await v2.open();
        const got = await v2.wallets.get(w.id);
        expect(got.multisigs.length).toBe(1);
        const reloaded = got.multisigs[0];
        expect(reloaded.threshold).toBe(2);
        expect(reloaded.scheme).toBe('p2wsh-multisig');
        const validation = validateMultisigConfig(reloaded);
        expect(validation.ok).toBe(true);
        await v2.close();
    });
});
