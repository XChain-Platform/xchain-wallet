// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// SDK releases before 0.28 know only FILE format 0, so the wallet serializes
// the multi-part manifest and part action formats. The real pinned SDK is used
// here to keep that compatibility behavior aligned across SDK releases.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { multipartFileActionString } from '../../../packages/core/src/flows/multipartFileAction.js';

const HASH = 'ab'.repeat(32);
const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });

describe('the pinned SDK and multi-part FILE formats', () => {
    it('agrees with the pinned SDK on multi-part FILE actions', () => {
        const part = {
            action: 'FILE', params: { VERSION: '2', FILE_HASH: HASH, PART_INDEX: '25' },
        };
        let sdkPart;
        try {
            sdkPart = sdk.actions.createAction(part);
        } catch (error) {
            expect(error).toEqual(expect.objectContaining({
                message: expect.stringMatching(/FILE requires field: TYPE/),
            }));
            return;
        }

        expect(sdkPart.actionString).toBe(multipartFileActionString(part));

        const manifest = {
            action: 'FILE',
            params: {
                VERSION: '1', FILE_HASH: HASH, TOTAL_PARTS: '26', TOTAL_BYTES: '10000000',
                NAME: 'art.png', TYPE: 'image/png', TITLE: '', MEMO: 'm',
                GATE_TICKER: '', ENCRYPTION_METHOD: '', KEY_HASH: '', GATE_MIN_AMOUNT: '', COMPRESSION: '',
            },
        };
        expect(sdk.actions.createAction(manifest).actionString)
            .toBe(multipartFileActionString(manifest));
    });
});

describe('multi-part FILE action strings', () => {
    it('serializes a part as FILE|2|hash|index', () => {
        expect(multipartFileActionString({
            action: 'FILE', params: { VERSION: '2', FILE_HASH: HASH, PART_INDEX: '25' },
        })).toBe(`FILE|2|${HASH}|25`);
    });

    it('serializes a manifest in format order and trims trailing empty fields', () => {
        expect(multipartFileActionString({
            action: 'FILE',
            params: {
                VERSION: '1', FILE_HASH: HASH, TOTAL_PARTS: '26', TOTAL_BYTES: '10000000',
                NAME: 'art.png', TYPE: 'image/png', TITLE: '', MEMO: 'm',
                GATE_TICKER: '', ENCRYPTION_METHOD: '', KEY_HASH: '', GATE_MIN_AMOUNT: '', COMPRESSION: '',
            },
        })).toBe(`FILE|1|${HASH}|26|10000000|art.png|image/png||m`);
    });

    it('refuses a field carrying the field separator', () => {
        expect(() => multipartFileActionString({
            action: 'FILE', params: { VERSION: '1', FILE_HASH: HASH, NAME: 'a|b' },
        })).toThrow(expect.objectContaining({ code: 'FILE_MULTIPART_FIELD_INVALID' }));
    });

    it('leaves every other action to the SDK', () => {
        expect(multipartFileActionString({ action: 'FILE', params: { VERSION: '0', TYPE: 'x' } })).toBeNull();
        expect(multipartFileActionString({ action: 'BATCH', params: { VERSION: '0' } })).toBeNull();
    });

    it('matches the SDK serialization rule on the format it does know', () => {
        const params = { NAME: 'art.png', TYPE: 'image/png', TITLE: '', MEMO: 'm' };
        expect(sdk.actions.createAction({ action: 'FILE', params }).actionString)
            .toBe('FILE|0|art.png|image/png||m');
    });
});
