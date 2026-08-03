// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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

        // The two properties the on-chain publish actually rests on. This
        // payload is broadcast to a PUBLIC ledger and can never be retracted,
        // and the Settings copy promises "only someone who already has your
        // seed can decrypt them" - so these are the assertions behind that
        // sentence. Neither was covered: the round-trip above proves the
        // codec is reversible, which a plain JSON encoder would also pass.
        it('leaks no plaintext: labels, contacts and notes are absent from the blob', async () => {
            const k = computeLabelSyncCommitmentKey(SEED);
            // High-entropy canaries, so a hit cannot be a coincidence and a
            // miss cannot be a short-string fluke.
            const canaries = ['ZQ7LABELCANARY41', 'ZQ7CONTACTCANARY42', 'ZQ7NOTECANARY43'];
            const body = {
                version: 1,
                labels: [{ id: 'a', address: 'ltc1qexample', label: canaries[0] }],
                contacts: [{ id: 'b', name: canaries[1], notes: canaries[2], entries: [] }],
            };
            const blob = await encodeLabelSyncPayload(k, body);

            // Searched three ways, because "not in the UTF-8 view" alone would
            // pass on a hex- or base64-encoded plaintext.
            const asUtf8 = Buffer.from(blob).toString('latin1');
            const asHex = Buffer.from(blob).toString('hex');
            const asB64 = Buffer.from(blob).toString('base64');
            for (const canary of canaries) {
                expect(asUtf8, `"${canary}" survives as readable bytes`).not.toContain(canary);
                expect(asHex, `"${canary}" survives hex-encoded`)
                    .not.toContain(Buffer.from(canary, 'utf8').toString('hex'));
                expect(asB64, `"${canary}" survives base64-encoded`)
                    .not.toContain(Buffer.from(canary, 'utf8').toString('base64').replace(/=+$/, ''));
            }
            // The control: without it, a codec that silently dropped `labels`
            // and `contacts` would pass every assertion above.
            const back = await decodeLabelSyncPayload(k, blob);
            expect(back.labels[0].label).toBe(canaries[0]);
            expect(back.contacts[0].name).toBe(canaries[1]);
            expect(back.contacts[0].notes).toBe(canaries[2]);
        });

        it('uses a fresh IV: the same body encrypted twice differs', async () => {
            // AES-GCM reuses of an (key, IV) pair are catastrophic - two
            // ciphertexts under one pair leak their plaintexts' XOR and break
            // authentication. The commitment key is FIXED for the life of a
            // seed and every re-publish encrypts near-identical data under it,
            // so IV freshness is the only thing standing between a user who
            // publishes twice and a recoverable payload.
            const k = computeLabelSyncCommitmentKey(SEED);
            const body = { version: 1, labels: [{ id: 'a', address: 'ltc1q', label: 'same' }] };
            const first = await encodeLabelSyncPayload(k, body);
            const second = await encodeLabelSyncPayload(k, body);
            expect(Buffer.from(first).toString('hex'))
                .not.toBe(Buffer.from(second).toString('hex'));
            // Specifically the IV, rather than "something differed": the first
            // 12 bytes are the nonce, and equal nonces under one key is the
            // failure this guards.
            expect(Buffer.from(first.slice(0, 12)).toString('hex'))
                .not.toBe(Buffer.from(second.slice(0, 12)).toString('hex'));
            // Length-preserving, so a size delta on chain reflects the
            // plaintext rather than a compressor.
            expect(first.length).toBe(second.length);
        });
    });
});
