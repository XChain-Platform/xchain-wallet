// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { taprootUnavailableReason, uploadMethodSizes } from '../../../packages/core/src/flows/uploadMethod.js';
import {
    bitcoinDescriptors,
    dogecoinDescriptors,
    litecoinDescriptors,
} from '../../../packages/core/src/registry/descriptors/index.js';

const envelopeDescriptors = [...bitcoinDescriptors, ...litecoinDescriptors];
const softwareSources = ['hd', 'imported-wif'];

describe('upload envelope availability by chain capability and source type', () => {
    it('offers every Bitcoin and Litecoin software address type the envelope', () => {
        for (const descriptor of envelopeDescriptors) {
            for (const addressType of descriptor.addressTypes) {
                for (const source of softwareSources) {
                    const fromAddress = { source, addressType };
                    expect(taprootUnavailableReason({ descriptor, fromAddress }),
                        `${descriptor.id}/${addressType}/${source}`).toBeNull();
                }
            }
        }
    });

    it('sizes the envelope from the declared capability instead of p2tr addresses', () => {
        for (const descriptor of litecoinDescriptors) {
            expect(descriptor.addressTypes, descriptor.id).not.toContain('p2tr');
            expect(uploadMethodSizes({ compiledBytes: 9_000, descriptor }).taproot,
                descriptor.id).toBeGreaterThan(0);
        }
    });
});

describe('upload envelope refusal reasons', () => {
    it.each([
        ['watcher', { source: 'hd' }, true],
        ['hardware', { source: 'trezor' }, false],
        ['hardware', { source: 'ledger' }, false],
        ['watchOnly', { source: 'watch-only' }, false],
        ['signer', { source: 'unknown' }, false],
        ['signer', null, false],
    ])('returns %s for incapable Bitcoin and Litecoin sources', (reason, fromAddress, isWatcherMode) => {
        for (const descriptor of envelopeDescriptors) {
            expect(taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode }), descriptor.id)
                .toBe(reason);
        }
    });

    it('keeps chain refusals ahead of source refusals', () => {
        for (const descriptor of dogecoinDescriptors) {
            expect(taprootUnavailableReason({ descriptor, fromAddress: { source: 'trezor' } }), descriptor.id)
                .toBe('noTaproot');
            expect(uploadMethodSizes({ compiledBytes: 5_000, descriptor }).taproot, descriptor.id)
                .toBeNull();
        }
        expect(taprootUnavailableReason({ descriptor: null, fromAddress: { source: 'hd' } }))
            .toBe('chain');
    });

    it('never returns the retired Litecoin reason', () => {
        const reasons = litecoinDescriptors.flatMap((descriptor) => softwareSources.map((source) => (
            taprootUnavailableReason({ descriptor, fromAddress: { source } })
        )));
        expect(reasons).not.toContain('litecoinPending');
    });
});
