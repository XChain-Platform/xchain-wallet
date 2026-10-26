// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An airdrop's recipients ride one LIST v0. Above 8 KB compiled the encoder
// puts it in a Taproot envelope whose reveal the SDK decoder refuses
// (REST_FIELD_UNSUPPORTED on LIST's variadic ITEM), so the wallet refused it
// at Approve with tamper wording. These pin the byte sizer that lets the form
// name the limit before compose, and its parity with the SDK's own LIST string.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import {
    listActionString,
    listActionBytes,
    maxListItemsThatFit,
    splitListItems,
    MAX_SIGNABLE_LIST_BYTES,
} from '../../../packages/core/src/airdrop/listSizeLimit.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });

const regtest = bitcoin.networks.regtest;
// Deterministic 44-character native segwit regtest addresses.
const segwitAddress = (i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i).padStart(40, '0'), 'hex'),
    network: regtest,
}).address;
const segwit = (n) => Array.from({ length: n }, (_, i) => segwitAddress(i));
// Fixed-length strings stand in for longer address families; the sizer counts bytes only.
const ofLength = (len, n) => Array.from({ length: n }, (_, i) => String(i).padStart(len, 'x'));

describe('listSizeLimit', () => {
    it('builds the same LIST string the SDK serializes', () => {
        const items = segwit(5);
        const sdkString = sdk.actions.createAction({
            action: 'LIST', params: { VERSION: '0', TYPE: '2', ITEM: items },
        }).actionString;
        expect(listActionString(items, '2')).toBe(sdkString);
        expect(listActionString(['JDOG', 'BRRR'], '1')).toBe(sdk.actions.createAction({
            action: 'LIST', params: { VERSION: '0', TYPE: '1', ITEM: ['JDOG', 'BRRR'] },
        }).actionString);
    });

    it('sizes the LIST as the compiled push the confirm lane sizes', () => {
        const items = segwit(3);
        const compiled = bitcoin.script.compile([Buffer.from(listActionString(items, '2'), 'utf8')]).length;
        expect(listActionBytes(items, '2')).toBe(compiled);
    });

    it('fits 181 native segwit regtest addresses and refuses the 182nd', () => {
        expect(segwitAddress(0)).toHaveLength(44);
        const items = segwit(200);
        expect(maxListItemsThatFit(items, '2')).toBe(181);
        expect(listActionBytes(items.slice(0, 181), '2')).toBeLessThanOrEqual(MAX_SIGNABLE_LIST_BYTES);
        expect(listActionBytes(items.slice(0, 182), '2')).toBeGreaterThan(MAX_SIGNABLE_LIST_BYTES);
    });

    it('is a byte limit, so longer addresses fit fewer per airdrop', () => {
        // 62 characters is a mainnet Taproot address, 64 a regtest one.
        expect(maxListItemsThatFit(ofLength(62, 300), '2')).toBe(129);
        expect(maxListItemsThatFit(ofLength(64, 300), '2')).toBe(125);
    });

    it('reports a list that fits as fitting whole', () => {
        const items = segwit(150);
        expect(maxListItemsThatFit(items, '2')).toBe(150);
        expect(splitListItems(items, '2')).toEqual([items]);
    });

    it('splits a large list into consecutive batches that each fit', () => {
        const items = segwit(400);
        const batches = splitListItems(items, '2');
        expect(batches.map((b) => b.length)).toEqual([181, 181, 38]);
        expect(batches.flat()).toEqual(items);
        for (const batch of batches) expect(listActionBytes(batch, '2')).toBeLessThanOrEqual(MAX_SIGNABLE_LIST_BYTES);
    });

    it('stays linear on a very large paste', () => {
        const items = ofLength(44, 20000);
        const started = performance.now();
        expect(maxListItemsThatFit(items, '2')).toBe(181);
        expect(performance.now() - started).toBeLessThan(500);
    });
});
