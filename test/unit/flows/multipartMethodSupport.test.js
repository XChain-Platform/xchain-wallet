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
import { chooseFileUploadPath } from '../../../packages/core/src/flows/fileUploadPath.js';
import {
    multipartSupportForMethod,
} from '../../../packages/core/src/flows/multipartMethodSupport.js';
import {
    bitcoinDescriptors,
    dogecoinDescriptors,
    litecoinDescriptors,
} from '../../../packages/core/src/registry/descriptors/index.js';

const ADDRESS_TYPES = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2tr'];
const DESCRIPTORS = [bitcoinDescriptors, litecoinDescriptors, dogecoinDescriptors]
    .map((entries) => entries.find(({ networkKind }) => networkKind === 'regtest'));
const SOFTWARE_ADDRESS = Object.freeze({ source: 'hd', label: 'Primary' });

function methodSupport(method, descriptor, addressType, overrides = {}) {
    return multipartSupportForMethod({
        method,
        descriptor,
        addressRecord: SOFTWARE_ADDRESS,
        addressType,
        ...overrides,
    });
}

function expectedSupport(method, descriptor, addressType) {
    if (method === 'taproot' && descriptor.coin === 'dogecoin') {
        return { supported: false, reason: 'noTaproot' };
    }
    if (method === 'standard' && addressType === 'p2tr') {
        return { supported: false, reason: 'sourceType' };
    }
    const oneCall = addressType === 'p2wpkh' || addressType === 'p2tr'
        || method === 'standard';
    return {
        supported: true,
        lane: method === 'taproot' ? 'envelope' : 'standard',
        buildMode: oneCall ? 'one_call' : 'two_step',
    };
}

describe('multipart method matrix', () => {
    it.each(['taproot', 'standard'])('plans %s on each regtest descriptor and type', (method) => {
        for (const descriptor of DESCRIPTORS) {
            for (const addressType of ADDRESS_TYPES) {
                expect(methodSupport(method, descriptor, addressType),
                    `${method} ${descriptor.id} ${addressType}`)
                    .toEqual(expectedSupport(method, descriptor, addressType));
            }
        }
    });

    it('pins the p2tr and Dogecoin method boundaries', () => {
        expect(methodSupport('standard', DESCRIPTORS[0], 'p2tr'))
            .toEqual({ supported: false, reason: 'sourceType' });
        expect(methodSupport('taproot', DESCRIPTORS[0], 'p2tr'))
            .toEqual({ supported: true, lane: 'envelope', buildMode: 'one_call' });
        expect(methodSupport('taproot', DESCRIPTORS[2], 'p2tr'))
            .toEqual({ supported: false, reason: 'noTaproot' });
    });
});

describe('multipart method signer refusals', () => {
    it.each([
        ['watcher', { source: 'hd' }, true],
        ['hardware', { source: 'trezor' }, false],
        ['watchOnly', { source: 'watch-only' }, false],
        ['signer', { source: 'unknown' }, false],
    ])('returns %s for both methods', (reason, addressRecord, isWatcherMode) => {
        for (const method of ['taproot', 'standard']) {
            expect(methodSupport(method, DESCRIPTORS[0], 'p2wpkh', {
                addressRecord, isWatcherMode,
            })).toEqual({ supported: false, reason });
        }
    });
});

describe('multipart method upload path compatibility', () => {
    it('uses only encoder build modes for supported results', () => {
        for (const method of ['taproot', 'standard']) {
            for (const descriptor of DESCRIPTORS) {
                for (const addressType of ADDRESS_TYPES) {
                    const result = methodSupport(method, descriptor, addressType);
                    if (result.supported) expect(['one_call', 'two_step']).toContain(result.buildMode);
                }
            }
        }
    });

    it('selects multipart or preserves the refusal reason for every result', () => {
        for (const method of ['taproot', 'standard']) {
            for (const descriptor of DESCRIPTORS) {
                for (const addressType of ADDRESS_TYPES) {
                    const support = methodSupport(method, descriptor, addressType);
                    const path = chooseFileUploadPath({
                        byteLength: 400_000, singleTransactionCap: 8_192, support,
                    });
                    expect(path.path).toBe(support.supported ? 'multipart' : 'refused');
                    if (!support.supported) expect(path.reason).toBe(support.reason);
                }
            }
        }
    });
});

describe('multipart method input contract', () => {
    it.each([undefined, null, '', 'envelope', 'STANDARD', 1, {}])(
        'refuses an invalid method: %#',
        (method) => {
            expect(() => methodSupport(method, DESCRIPTORS[0], 'p2wpkh'))
                .toThrow(expect.objectContaining({
                    name: 'TypeError', code: 'MULTIPART_METHOD_INVALID',
                }));
        },
    );

    it('does not mutate any input', () => {
        const descriptor = Object.freeze({ ...DESCRIPTORS[0] });
        const addressRecord = Object.freeze({ source: 'hd', label: 'Primary' });
        const input = Object.freeze({
            method: 'taproot', descriptor, addressRecord,
            addressType: 'p2tr', isWatcherMode: false,
        });
        const before = structuredClone(input);

        expect(multipartSupportForMethod(input)).toEqual({
            supported: true, lane: 'envelope', buildMode: 'one_call',
        });
        expect(input).toEqual(before);
    });
});
