// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: encrypted label-sync envelope + commitment-key derivation.

import { describe, it, expect } from 'vitest';
import {
    LABEL_SYNC_DOMAIN,
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    encodeLabelSyncPayload,
    decodeLabelSyncPayload,
} from '../../../packages/core/src/crypto/labelSync.js';

const SEED = new Uint8Array(64);
for (let i = 0; i < 64; i += 1) SEED[i] = i;

describe('crypto/labelSync', () => {
    describe('commitment key', () => {
        it('is deterministic for the same seed', () => {
            const a = computeLabelSyncCommitmentKey(SEED);
            const b = computeLabelSyncCommitmentKey(SEED);
            expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
        });

        it('returns a 32-byte key', () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            expect(k.length).toBe(32);
        });

        it('different seeds → different commitment keys', () => {
            const other = new Uint8Array(64).fill(0xff);
            const a = computeLabelSyncCommitmentKey(SEED);
            const b = computeLabelSyncCommitmentKey(other);
            expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
        });

        it('rejects empty seed', () => {
            expect(() => computeLabelSyncCommitmentKey(new Uint8Array(0))).toThrow();
        });

        it('domain string is namespaced', () => {
            expect(LABEL_SYNC_DOMAIN).toContain('xchain');
        });
    });

    describe('discovery name', () => {
        it('returns a string', () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            const name = computeLabelSyncDiscoveryName(k);
            expect(typeof name).toBe('string');
            expect(name.length).toBeGreaterThan(0);
        });

        it('rejects a non-32-byte commitment key', () => {
            expect(() => computeLabelSyncDiscoveryName(new Uint8Array(31))).toThrow();
        });
    });

    describe('payload encrypt/decrypt', () => {
        it('round-trips a label payload', async () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            // Decoder requires `version: 1` on the payload object;
            // anything else is rejected as "unsupported payload version".
            const body = { version: 1, addresses: { 'bc1qabc': 'My BTC' } };
            const blob = await encodeLabelSyncPayload(k, body);
            const back = await decodeLabelSyncPayload(k, blob);
            expect(back).toEqual(body);
        });

        it('refuses to decrypt with a different commitment key', async () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            const otherSeed = new Uint8Array(64).fill(2);
            const k2 = computeLabelSyncCommitmentKey(otherSeed);
            const blob = await encodeLabelSyncPayload(k, { version: 1, x: 1 });
            await expect(decodeLabelSyncPayload(k2, blob)).rejects.toThrow();
        });

        it('rejects a payload without version: 1 on decode (forward-compat guard)', async () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            const blob = await encodeLabelSyncPayload(k, { version: 2 });
            await expect(decodeLabelSyncPayload(k, blob)).rejects.toThrow(/version/);
        });
    });
});
