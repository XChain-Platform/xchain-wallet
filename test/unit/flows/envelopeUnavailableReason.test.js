// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    envelopeChainFor,
    envelopeUnavailableReason,
} from '../../../packages/core/src/flows/envelopeSelection.js';
import {
    bitcoinDescriptors,
    dogecoinDescriptors,
    litecoinDescriptors,
} from '../../../packages/core/src/registry/descriptors/index.js';

const envelopeDescriptors = [...bitcoinDescriptors, ...litecoinDescriptors];
const allDescriptors = [...envelopeDescriptors, ...dogecoinDescriptors];

describe('envelope chain capability', () => {
    it('accepts every Bitcoin and Litecoin network', () => {
        for (const descriptor of envelopeDescriptors) {
            expect(envelopeChainFor(descriptor), descriptor.id).toBe(true);
        }
    });

    it('rejects every Dogecoin network and missing declarations', () => {
        for (const descriptor of dogecoinDescriptors) {
            expect(envelopeChainFor(descriptor), descriptor.id).toBe(false);
        }
        expect(envelopeChainFor({})).toBe(false);
        expect(envelopeChainFor(null)).toBe(false);
    });

    it('accepts p2tr without an explicit envelope declaration', () => {
        expect(envelopeChainFor({ addressTypes: ['p2tr'] })).toBe(true);
    });
});

describe('available envelope reason', () => {
    it.each(['hd', 'imported-wif'])('returns null for every capable network with %s', (source) => {
        for (const descriptor of envelopeDescriptors) {
            expect(envelopeUnavailableReason({
                descriptor,
                fromAddress: { source },
            }), descriptor.id).toBeNull();
        }
    });

    it('accepts a p2tr address type without taprootEnvelope', () => {
        expect(envelopeUnavailableReason({
            descriptor: { addressTypes: ['p2tr'] },
            fromAddress: { source: 'hd' },
        })).toBeNull();
    });
});

describe('unavailable envelope chain reason', () => {
    it('returns noTaproot for every Dogecoin network', () => {
        for (const descriptor of dogecoinDescriptors) {
            expect(envelopeUnavailableReason({
                descriptor,
                fromAddress: { source: 'hd' },
            }), descriptor.id).toBe('noTaproot');
        }
    });

    it('checks the Dogecoin chain before watcher mode', () => {
        expect(envelopeUnavailableReason({
            descriptor: dogecoinDescriptors[0],
            fromAddress: { source: 'hd' },
            isWatcherMode: true,
        })).toBe('noTaproot');
    });

    it.each([{}, null])('returns chain for %j', (descriptor) => {
        expect(envelopeUnavailableReason({ descriptor, fromAddress: { source: 'hd' } }))
            .toBe('chain');
    });
});

describe('unavailable envelope signer reason', () => {
    it.each([
        ['watcher', { source: 'hd' }, true],
        ['hardware', { source: 'trezor' }, false],
        ['hardware', { source: 'ledger' }, false],
        ['watchOnly', { source: 'watch-only' }, false],
        ['signer', { source: 'unknown' }, false],
        ['signer', null, false],
        ['signer', 'hd', false],
    ])('returns %s on Bitcoin and Litecoin', (reason, fromAddress, isWatcherMode) => {
        for (const descriptor of [bitcoinDescriptors[0], litecoinDescriptors[0]]) {
            expect(envelopeUnavailableReason({ descriptor, fromAddress, isWatcherMode }))
                .toBe(reason);
        }
    });

    it('never returns the retired Litecoin reason', () => {
        const results = allDescriptors.flatMap((descriptor) => [
            envelopeUnavailableReason({ descriptor, fromAddress: { source: 'hd' } }),
            envelopeUnavailableReason({ descriptor, fromAddress: null }),
        ]);
        expect(results).not.toContain('litecoinPending');
    });
});

describe('envelope reason input ownership', () => {
    it('does not mutate descriptors, addresses, or the argument object', () => {
        const descriptor = { coin: 'bitcoin', addressTypes: ['p2tr'] };
        const fromAddress = { source: 'hd', label: 'Primary' };
        const args = { descriptor, fromAddress, isWatcherMode: false };
        const before = structuredClone(args);

        expect(envelopeUnavailableReason(args)).toBeNull();
        expect(envelopeChainFor(descriptor)).toBe(true);
        expect(args).toEqual(before);
    });
});
