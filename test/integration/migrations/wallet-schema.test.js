// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: schema migrations run on read so legacy on-disk records
// from prior wallet versions surface in their current shape without a
// disk rewrite. Wallet v1 (singular `multisig` config) → v2 (plural
// `multisigs[]` array) is the live migration we lean on most often;
// other collections register migrations via the same harness and only
// need a smoke entry here once they ship.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { encodeDocument, emptyDocument, DOCUMENT_VERSION } from '../../../packages/core/src/storage/codec.js';

const MASTER_KEY = new Uint8Array(32).fill(33);

// A simulated v1 wallet record — schemaVersion: 1, with the singular
// `multisig` field that v2 renamed to `multisigs[]`. Other v2-required
// fields (importedKeys, encryptionAlgorithm) are present too because
// migrateWallet only touches what changed between v1 and v2.
function v1Wallet() {
    return {
        schemaVersion: 1,
        id: 'wallet-legacy-id',
        name: 'Legacy wallet',
        createdAt: '2026-04-24T00:00:00.000Z',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptedSeed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        kdfParams: {
            algorithm: 'argon2id',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            iterations: 3,
            memory: 65536,
            parallelism: 1,
        },
        importedKeys: [],
        multisig: null, // singular — the v1 shape
    };
}

describe('integration/migrations/wallet v1 → v2', () => {
    it('reads a v1 record and surfaces it shaped as v2 (`multisigs: []`)', async () => {
        const backend = new InMemoryBackend();

        // Hand-build a v1 document and persist it through the codec
        // so the next Vault.open() sees a real legacy blob.
        const legacyDoc = {
            ...emptyDocument(),
            wallets: [v1Wallet()],
        };
        legacyDoc.version = DOCUMENT_VERSION;
        const blob = await encodeDocument(MASTER_KEY, legacyDoc);
        await backend.save(blob);

        // Open and read — the migration harness should rewrite the
        // wallet record in-flight.
        const vault = new Vault({ backend, masterKey: MASTER_KEY });
        await vault.open();
        const wallet = await vault.wallets.get('wallet-legacy-id');
        expect(wallet).toBeTruthy();
        expect(Array.isArray(wallet.multisigs)).toBe(true);
        expect(wallet.schemaVersion).toBeGreaterThanOrEqual(2);
        await vault.close();
    });
});
