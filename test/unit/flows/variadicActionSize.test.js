// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// LIST v0, v1 and v4 and DEPLOY v0 and v2 end in a repeating field. Above 8 KB
// compiled they move into a Taproot envelope whose reveal the SDK decoder
// cannot read, so the wallet cannot verify them. These pin the shared sizer,
// byte for byte, against the SDK's own createAction for every such action.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import {
    MAX_VERIFIABLE_ACTION_BYTES,
    hasVariadicTail,
    variadicActionBytes,
    variadicActionFit,
    variadicActionString,
    variadicSizeMessage,
} from '../../../packages/core/src/flows/variadicActionSize.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
const sdkString = (action, params) => sdk.actions.createAction({ action, params }).actionString;

// Deterministic 44-character native segwit regtest addresses, which LIST TYPE 2 validates.
const segwit = (n) => Array.from({ length: n }, (_, i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i).padStart(40, '0'), 'hex'),
    network: bitcoin.networks.regtest,
}).address);
const entries = (len, n) => Array.from({ length: n }, (_, i) => String(i).padStart(len, 'x'));
const HASH = 'a'.repeat(64);

const CASES = [
    ['LIST', { VERSION: '0', TYPE: '2', ITEM: segwit(5) }],
    ['LIST', { VERSION: '0', TYPE: '1', MEMO: 'note', ITEM: ['JDOG', 'BRRR'] }],
    ['LIST', { VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '9', ITEM: entries(10, 3) }],
    ['LIST', { VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '123', MEMO: 'm', ITEM: ['A'] }],
    ['LIST', { VERSION: '4', TYPE: '2', NAME: 'Team', DESCRIPTION: 'People', ITEM: segwit(4) }],
    ['LIST', { VERSION: '4', TYPE: '1', ITEM: ['A'] }],
    ['DEPLOY', { VERSION: '0', CODE: 'module.exports={}', GAS_LIMIT: '1000' }],
    ['DEPLOY', { VERSION: '0', CODE: 'café \u{1F600}', GAS_LIMIT: '1000', CONSTRUCTOR_PARAMS: ['a', 'b'] }],
    ['DEPLOY', { VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '1000' }],
    ['DEPLOY', { VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '1000', CONSTRUCTOR_PARAMS: entries(20, 6) }],
];

describe('variadicActionSize', () => {
    it.each(CASES)('builds the string the SDK serializes for %s %j', (action, params) => {
        expect(variadicActionString(action, params)).toBe(sdkString(action, params));
    });

    it('sizes the compiled push the confirm lane sizes', () => {
        const [action, params] = CASES[0];
        const s = sdkString(action, params);
        expect(variadicActionBytes(action, params)).toBe(Buffer.byteLength(s) + 1 + (s.length > 75 ? 1 : 0));
    });

    it('covers exactly the formats that end in a repeating field', () => {
        expect(hasVariadicTail('LIST', { VERSION: '0' })).toBe(true);
        expect(hasVariadicTail('LIST', { VERSION: '4' })).toBe(true);
        expect(hasVariadicTail('DEPLOY', { VERSION: '2' })).toBe(true);
        expect(hasVariadicTail('LIST', { VERSION: '2' })).toBe(false);
        expect(hasVariadicTail('DEPLOY', { VERSION: '1' })).toBe(false);
        expect(() => variadicActionString('SEND', { VERSION: '0' })).toThrow(/Unsupported/);
    });

    describe.each([
        ['LIST v0', 'LIST', (items) => ({ VERSION: '0', TYPE: '2', ITEM: items })],
        ['LIST v1', 'LIST', (items) => ({ VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '12', ITEM: items })],
        ['LIST v4', 'LIST', (items) => ({ VERSION: '4', TYPE: '2', NAME: 'N', DESCRIPTION: 'D', ITEM: items })],
        ['DEPLOY v0', 'DEPLOY', (items) => ({ VERSION: '0', CODE: 'x', GAS_LIMIT: '9', CONSTRUCTOR_PARAMS: items })],
        ['DEPLOY v2', 'DEPLOY', (items) => ({ VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '9', CONSTRUCTOR_PARAMS: items })],
    ])('%s ceiling', (_name, action, make) => {
        it('fits as many entries as keep the compiled size within 8192', () => {
            const items = entries(44, 400);
            const verdict = variadicActionFit(action, make(items));
            expect(verdict.fits).toBe(false);
            expect(verdict.given).toBe(400);
            expect(variadicActionBytes(action, make(items.slice(0, verdict.fit))))
                .toBeLessThanOrEqual(MAX_VERIFIABLE_ACTION_BYTES);
            expect(variadicActionBytes(action, make(items.slice(0, verdict.fit + 1))))
                .toBeGreaterThan(MAX_VERIFIABLE_ACTION_BYTES);
        });

        it('reports a small action as fitting whole', () => {
            const verdict = variadicActionFit(action, make(entries(44, 10)));
            expect(verdict).toMatchObject({ fits: true, given: 10, fit: 10 });
            expect(variadicSizeMessage(verdict)).toBeNull();
        });
    });

    it('stays linear on a very large paste', () => {
        const started = performance.now();
        const verdict = variadicActionFit('LIST', { VERSION: '0', TYPE: '2', ITEM: entries(44, 20000) });
        expect(verdict.fit).toBe(181);
        expect(performance.now() - started).toBeLessThan(500);
    });

    it('names the limit, how many fit and how many were given', () => {
        const verdict = variadicActionFit('LIST', { VERSION: '0', TYPE: '2', ITEM: entries(44, 300) });
        expect(variadicSizeMessage(verdict, { subject: 'This list', singular: 'address', plural: 'addresses' }))
            .toBe('This list has 300 addresses (13,512 bytes), but one action holds 8,192 bytes, '
                + 'which fits 181 of them. Remove 119 addresses.');
    });

    it('says so when not even one entry fits', () => {
        const verdict = variadicActionFit('DEPLOY', {
            VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '9', CONSTRUCTOR_PARAMS: ['y'.repeat(9000)],
        });
        expect(verdict.fit).toBe(0);
        expect(variadicSizeMessage(verdict, { subject: 'The constructor parameters' }))
            .toMatch(/over the 8,192 bytes one action can hold, and not even one entry fits/);
    });
});
