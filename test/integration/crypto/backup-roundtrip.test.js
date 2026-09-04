// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: encode → stringify → parse → decode of a non-trivial
// backup payload (multi-wallet, contacts, signers).

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

// Every case here pays a real Argon2id derivation at the production floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });
import {
    encodeBackupEnvelope,
    decodeBackupEnvelope,
    stringifyBackupEnvelope,
    parseBackupEnvelope,
} from '../../../packages/core/src/crypto/backup.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

describe('integration/crypto/backup-roundtrip', () => {
    it('encode → stringify → parse → decode round-trips a complex payload', async () => {
        const payload = {
            wallets: [{ id: 'w1', name: 'A' }, { id: 'w2', name: 'B' }],
            contacts: [{ name: 'alice', address: 'bc1qabc' }],
            signers: [{ id: 's1', kind: 'software' }],
            settings: { theme: 'dark', autoLockSec: 300 },
        };
        const env = await encodeBackupEnvelope({
            password: 'p',
            payload,
            walletName: 'A',
            kdfParams: KDF_PARAMS,
        });
        const json = stringifyBackupEnvelope(env);
        const parsed = parseBackupEnvelope(json);
        const back = await decodeBackupEnvelope({ password: 'p', envelope: parsed });
        expect(back).toEqual(payload);
    });

    it('JSON serialisation is human-readable (pretty-printed)', async () => {
        const env = await encodeBackupEnvelope({
            password: 'p', payload: { x: 1 }, walletName: 'A', kdfParams: KDF_PARAMS,
        });
        const json = stringifyBackupEnvelope(env);
        // Pretty-printed output contains line breaks; one-line output
        // is a smell that the export produced unreadable JSON.
        expect(json.includes('\n')).toBe(true);
    });
});
