// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    BUNDLED_DESCRIPTORS,
    ChainRegistry,
} from '../../../packages/core/src/registry/index.js';

const bitcoinMainnet = () => structuredClone(
    BUNDLED_DESCRIPTORS.find((descriptor) => descriptor.id === 'bitcoin-mainnet'),
);

describe('ChainRegistry edge branches', () => {
    it('rejects invalid and duplicate descriptors during construction', () => {
        expect(() => new ChainRegistry({ bundled: [{ id: 'broken' }] }))
            .toThrow('ChainRegistry: invalid descriptor "broken"');
        const descriptor = bitcoinMainnet();
        expect(() => new ChainRegistry({ bundled: [descriptor, structuredClone(descriptor)] }))
            .toThrow('ChainRegistry: duplicate chain id "bitcoin-mainnet"');
    });

    it('supports empty registries and all lookup projections', () => {
        const empty = new ChainRegistry({ bundled: [] });
        expect(empty.supportedChains()).toEqual([]);
        expect(empty.coins()).toEqual([]);
        expect(empty.descriptorFor('missing')).toBeNull();
        expect(empty.chainIdFor('bitcoin', 'mainnet')).toBeNull();

        const registry = new ChainRegistry();
        expect(registry.has('bitcoin-mainnet')).toBe(true);
        expect(registry.byCoin('litecoin')).toHaveLength(3);
        expect(registry.byNetworkKind('regtest')).toHaveLength(3);
        expect(registry.coins()).toEqual(['bitcoin', 'dogecoin', 'litecoin']);
        expect(registry.descriptorFor('bitcoin-mainnet')?.coin).toBe('bitcoin');
        expect(registry.chainIdFor('dogecoin', 'testnet')).toBe('dogecoin-testnet');
    });

    it('resolves standard paths and null branches without partial substitution', () => {
        const registry = new ChainRegistry();
        expect(registry.derivationPathFor('bitcoin-mainnet', 'p2wpkh', 3, 1, 9))
            .toBe("m/84'/0'/3'/1/9");
        expect(registry.derivationPathFor('missing', 'p2wpkh', 0, 0, 0)).toBeNull();
        expect(registry.derivationPathFor('bitcoin-mainnet', 'missing', 0, 0, 0)).toBeNull();
    });

    it('enforces the single-account counterwallet path rule', () => {
        const registry = new ChainRegistry();
        expect(registry.derivationPathFor(
            'bitcoin-mainnet', 'missing', 0, 1, 7, { format: 'counterwallet-legacy' },
        )).toBe("m/0'/1/7");
        expect(() => registry.derivationPathFor(
            'bitcoin-mainnet', 'p2pkh', 1, 0, 0, { format: 'counterwallet-legacy' },
        )).toThrow('counterwallet-legacy wallets have a single account');
    });

    it('refuses bundled removal and leaves unknown removal as a no-op', () => {
        const registry = new ChainRegistry();
        expect(() => registry.removeCustom('bitcoin-mainnet'))
            .toThrow('"bitcoin-mainnet" is bundled and cannot be removed');
        expect(registry.removeCustom('missing')).toBe(false);
        expect(registry.getVersion()).toBe(0);
    });

    it('validates an entire remote batch before mutating any entry', () => {
        const registry = new ChainRegistry();
        const update = bitcoinMainnet();
        update.displayName = 'Remote Bitcoin';
        const before = registry.get('bitcoin-mainnet');
        expect(() => registry.applyRemoteDescriptors([update, { id: 'broken' }]))
            .toThrow('ChainRegistry: invalid remote descriptor "broken"');
        expect(registry.get('bitcoin-mainnet')).toBe(before);
        expect(registry.get('bitcoin-mainnet').displayName).not.toBe('Remote Bitcoin');
        expect(registry.getVersion()).toBe(0);
    });
});
