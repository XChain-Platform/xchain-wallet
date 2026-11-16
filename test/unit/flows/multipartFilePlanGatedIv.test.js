// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { bytesToHex } from '@noble/hashes/utils';
import pako from 'pako';
import { describe, expect, it } from 'vitest';
import { planMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
const key = () => new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const iv = () => new Uint8Array(Array.from({ length: 12 }, (_, index) => index + 41));

async function gatedPlan(bytes, gateIv) {
    return planMultipartFile(bytes, {}, { gate: { key: key(), iv: gateIv } });
}

function decrypted(plan) {
    return new Uint8Array(sdk.gatedFile.decryptFileBytes(
        Buffer.from(plan.storedBytes),
        Buffer.from(plan.key),
    ));
}

describe('multipart gated IV replay', () => {
    it('rebuilds the same plan from a hex or byte IV', async () => {
        const bytes = new TextEncoder().encode('resume-safe gated multipart bytes');
        const gateIv = iv();
        const fromHex = await gatedPlan(bytes, bytesToHex(gateIv));
        const fromBytes = await gatedPlan(bytes, gateIv);

        expect(fromHex.fileHash).toBe(fromBytes.fileHash);
        expect(fromHex.storedBytes).toEqual(fromBytes.storedBytes);
        expect(fromHex.gateIv).toBe(bytesToHex(gateIv));
        expect(fromBytes.gateIv).toBe(bytesToHex(gateIv));
        expect(fromHex.storedBytes.slice(0, 12)).toEqual(gateIv);
    });

    it('draws a fresh IV when one is absent', async () => {
        const bytes = new TextEncoder().encode('fresh gated multipart bytes');
        const first = await planMultipartFile(bytes, {}, { gate: { key: key() } });
        const second = await planMultipartFile(bytes, {}, { gate: { key: key() } });

        expect(first.gateIv).toMatch(/^[0-9a-f]{24}$/);
        expect(second.gateIv).toMatch(/^[0-9a-f]{24}$/);
        expect(second.gateIv).not.toBe(first.gateIv);
        expect(second.fileHash).not.toBe(first.fileHash);
        expect(second.storedBytes).not.toEqual(first.storedBytes);
    });
});

describe('multipart gated SDK compatibility', () => {
    it('decrypts compressed plaintext through the pinned SDK', async () => {
        const bytes = new TextEncoder().encode('compress me '.repeat(80));
        const plan = await gatedPlan(bytes, iv());

        expect(plan.compressed).toBe(true);
        expect(decrypted(plan)).toEqual(pako.deflateRaw(bytes));
        expect(pako.inflateRaw(decrypted(plan))).toEqual(bytes);
    });

    it('decrypts raw plaintext through the pinned SDK', async () => {
        const bytes = new Uint8Array(Array.from({ length: 128 }, (_, index) => index));
        const plan = await gatedPlan(bytes, iv());

        expect(plan.compressed).toBe(false);
        expect(decrypted(plan)).toEqual(bytes);
    });
});

describe('multipart gated IV validation', () => {
    it.each([
        ['uppercase hex', '0102030405060708090A0B0C'],
        ['short hex', '010203'],
        ['non-hex text', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
        ['short bytes', new Uint8Array(11)],
        ['long bytes', new Uint8Array(13)],
        ['array', Array(12).fill(1)],
        ['array buffer', new ArrayBuffer(12)],
        ['null', null],
    ])('refuses %s', async (_label, gateIv) => {
        const error = await gatedPlan(new Uint8Array([1, 2, 3]), gateIv)
            .then(() => null, (caught) => caught);

        expect(error).toBeInstanceOf(RangeError);
        expect(error).toMatchObject({ code: 'GATE_IV_INVALID' });
    });
});

describe('multipart IV input ownership and ungated stability', () => {
    it('does not mutate gated inputs', async () => {
        const bytes = new Uint8Array([9, 8, 7, 6, 5]);
        const gateKey = key();
        const gateIv = iv();
        const meta = { name: 'owned.bin' };
        const options = { carrier: 'STANDARD', gate: { key: gateKey, iv: gateIv } };
        const snapshots = {
            bytes: new Uint8Array(bytes), key: new Uint8Array(gateKey), iv: new Uint8Array(gateIv),
            meta: { ...meta }, options: { carrier: options.carrier },
        };

        await planMultipartFile(bytes, meta, options);

        expect(bytes).toEqual(snapshots.bytes);
        expect(gateKey).toEqual(snapshots.key);
        expect(gateIv).toEqual(snapshots.iv);
        expect(meta).toEqual(snapshots.meta);
        expect(options).toEqual({ ...snapshots.options, gate: { key: gateKey, iv: gateIv } });
    });

    it('keeps the ungated hash stable and returns a null IV', async () => {
        const plan = await planMultipartFile(new Uint8Array([1, 2, 3, 4]));

        expect(plan.gateIv).toBeNull();
        expect(plan.fileHash).toBe('8de472e2399610baaa7f84840547cd409434e31f5d3bd71e4d947f283874f9c0');
    });
});
