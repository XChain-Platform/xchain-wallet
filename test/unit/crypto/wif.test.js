// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the WIF (Wallet Import Format) encoder/decoder.

import { describe, it, expect } from 'vitest';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { encodeWif, decodeWif } from '../../../packages/core/src/crypto/wif.js';

const bsc = base58check(sha256);

// Known compressed mainnet WIF (version byte 0x80) and its 32-byte key.
// Vector: privkey of all-0x01 bytes → this WIF (verifiable via any BIP-178 tool).
const MAINNET_WIF_VERSION = 0x80;
const KEY_ONES = new Uint8Array(32).fill(0x01);

describe('crypto/wif', () => {
    it('round-trips a 32-byte key through encode → decode (compressed)', () => {
        const wif = encodeWif(KEY_ONES, MAINNET_WIF_VERSION, true);
        expect(typeof wif).toBe('string');
        const { privateKey, compressed, versionByte } = decodeWif(wif);
        expect(Array.from(privateKey)).toEqual(Array.from(KEY_ONES));
        expect(compressed).toBe(true);
        expect(versionByte).toBe(MAINNET_WIF_VERSION);
    });

    it('round-trips an uncompressed key (33-byte payload, no flag byte)', () => {
        const wif = encodeWif(KEY_ONES, MAINNET_WIF_VERSION, false);
        const { privateKey, compressed, versionByte } = decodeWif(wif);
        expect(Array.from(privateKey)).toEqual(Array.from(KEY_ONES));
        expect(compressed).toBe(false);
        expect(versionByte).toBe(MAINNET_WIF_VERSION);
    });

    it('produces different strings for compressed vs uncompressed', () => {
        expect(encodeWif(KEY_ONES, MAINNET_WIF_VERSION, true))
            .not.toBe(encodeWif(KEY_ONES, MAINNET_WIF_VERSION, false));
    });

    it('compressed mainnet WIF begins with K or L', () => {
        const wif = encodeWif(KEY_ONES, MAINNET_WIF_VERSION, true);
        expect(['K', 'L']).toContain(wif[0]);
    });

    it('preserves a testnet version byte (0xef) through a round-trip', () => {
        const wif = encodeWif(KEY_ONES, 0xef, true);
        expect(decodeWif(wif).versionByte).toBe(0xef);
    });

    it('encodeWif defaults to compressed when the flag is omitted', () => {
        const wif = encodeWif(KEY_ONES, MAINNET_WIF_VERSION);
        expect(decodeWif(wif).compressed).toBe(true);
    });

    it('encodeWif rejects a non-Uint8Array key', () => {
        expect(() => encodeWif([1, 2, 3], MAINNET_WIF_VERSION))
            .toThrow(/32-byte Uint8Array/);
    });

    it('encodeWif rejects a key that is not exactly 32 bytes', () => {
        expect(() => encodeWif(new Uint8Array(31), MAINNET_WIF_VERSION))
            .toThrow(/32-byte Uint8Array/);
        expect(() => encodeWif(new Uint8Array(33), MAINNET_WIF_VERSION))
            .toThrow(/32-byte Uint8Array/);
    });

    it('decodeWif rejects a payload of unexpected length', () => {
        // Encode a base58check blob whose decoded length is neither 33 nor 34.
        // A WIF of an all-zero 10-byte payload decodes to length 10.
        const short = bsc.encode(new Uint8Array(10));
        expect(() => decodeWif(short)).toThrow(/unexpected payload length/);
    });

    it('decodeWif rejects a 34-byte payload whose flag byte is not 0x01', () => {
        const payload = new Uint8Array(34);
        payload[0] = MAINNET_WIF_VERSION;
        payload.set(KEY_ONES, 1);
        payload[33] = 0x02; // invalid compression flag
        const badWif = bsc.encode(payload);
        expect(() => decodeWif(badWif)).toThrow(/compressed flag byte must be 0x01/);
    });
});
