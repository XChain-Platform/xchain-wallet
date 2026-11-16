// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    maxUploadBytesFor,
    multipartSupportFor,
} from '../../../packages/core/src/flows/multipartSupport.js';

const SOFTWARE_ADDRESS = Object.freeze({ source: 'hd', label: 'Primary' });

function support(overrides = {}) {
    return multipartSupportFor({
        taprootChain: true,
        addressRecord: SOFTWARE_ADDRESS,
        addressType: 'p2wpkh',
        isWatcherMode: false,
        ...overrides,
    });
}

describe('multipartSupportFor lane selection', () => {
    it.each([
        ['p2pkh', 'two_step'],
        ['p2wpkh', 'one_call'],
        ['p2sh-p2wpkh', 'two_step'],
        ['p2tr', 'one_call'],
    ])('uses the envelope lane for a Taproot chain with %s', (addressType, buildMode) => {
        expect(support({ addressType })).toEqual({
            supported: true, lane: 'envelope', buildMode,
        });
    });

    it.each([
        ['p2pkh', 'one_call'],
        ['p2wpkh', 'one_call'],
        ['p2sh-p2wpkh', 'one_call'],
    ])('uses the standard lane for a non-Taproot chain with %s', (addressType, buildMode) => {
        expect(support({ taprootChain: false, addressType })).toEqual({
            supported: true, lane: 'standard', buildMode,
        });
    });
});

describe('multipartSupportFor refusal reasons', () => {
    it('refuses a p2tr source on the standard lane', () => {
        expect(support({ taprootChain: false, addressType: 'p2tr' }))
            .toEqual({ supported: false, reason: 'sourceType' });
    });

    it('checks watcher mode before every signer source', () => {
        for (const source of ['trezor', 'ledger', 'watch-only', 'unknown']) {
            expect(support({ addressRecord: { source }, isWatcherMode: true }))
                .toEqual({ supported: false, reason: 'watcher' });
        }
    });

    it.each(['trezor', 'ledger'])('names %s as hardware before signer refusal', (source) => {
        expect(support({ addressRecord: { source } }))
            .toEqual({ supported: false, reason: 'hardware' });
    });

    it('names watch-only before signer refusal', () => {
        expect(support({ addressRecord: { source: 'watch-only' } }))
            .toEqual({ supported: false, reason: 'watchOnly' });
    });

    it.each([{ source: 'airgap' }, { source: 'HD' }, {}, null])(
        'uses signer for another refused record %#',
        (addressRecord) => {
            expect(support({ addressRecord })).toEqual({ supported: false, reason: 'signer' });
        },
    );
});

describe('multipartSupportFor input contract', () => {
    it.each([undefined, null, 0, 1, 'true', {}, []])(
        'throws when taprootChain is not boolean: %#',
        (taprootChain) => {
            expect(() => support({ taprootChain })).toThrow(TypeError);
        },
    );

    it('does not mutate its input or address record', () => {
        const addressRecord = Object.freeze({ source: 'imported-wif', label: 'Cold' });
        const input = Object.freeze({
            taprootChain: false, addressRecord, addressType: 'p2pkh', isWatcherMode: false,
        });
        expect(multipartSupportFor(input)).toEqual({
            supported: true, lane: 'standard', buildMode: 'one_call',
        });
        expect(input).toEqual({
            taprootChain: false, addressRecord, addressType: 'p2pkh', isWatcherMode: false,
        });
    });
});

describe('maxUploadBytesFor', () => {
    it('uses the multipart cap for supported uploads', () => {
        expect(maxUploadBytesFor({ supported: true }, 260_000)).toBe(12_000_000);
    });

    it('keeps the single-transaction cap for unsupported uploads', () => {
        expect(maxUploadBytesFor({ supported: false, reason: 'hardware' }, 260_000)).toBe(260_000);
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '260000'])
        ('refuses a cap that is not a positive safe integer: %#', (singleTransactionCap) => {
            expect(() => maxUploadBytesFor({ supported: false }, singleTransactionCap))
                .toThrow(TypeError);
        });

    it('does not mutate the support input', () => {
        const supportResult = Object.freeze({ supported: false, reason: 'watcher' });
        expect(maxUploadBytesFor(supportResult, 10)).toBe(10);
        expect(supportResult).toEqual({ supported: false, reason: 'watcher' });
    });
});
