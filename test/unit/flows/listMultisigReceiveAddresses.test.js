// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    listMultisigReceiveAddresses,
    receiveMultisigAddress,
} from '../../../packages/core/src/flows/multisigAddress.js';

function multisig(id, scheme, threshold, names) {
    return {
        id,
        scheme,
        threshold,
        scriptTemplate: `${id}-template`,
        cosigners: names.map((name) => ({ name })),
    };
}

function harness(multisigs) {
    const wallet = { id: 'wallet-1', multisigs };
    const deriveMultisigAddress = vi.fn(({ scriptTemplate }) => ({
        address: `${scriptTemplate}-address`,
        witnessScript: `${scriptTemplate}-witness`,
    }));
    const vault = { wallets: { get: vi.fn(async () => wallet) } };
    const sdkRegistry = { get: vi.fn(() => ({ deriveMultisigAddress })) };
    return { vault, sdkRegistry, deriveMultisigAddress };
}

function options(h) {
    return {
        vault: h.vault,
        sdkRegistry: h.sdkRegistry,
        walletId: 'wallet-1',
        chainId: 'bitcoin-testnet',
    };
}

describe('listMultisigReceiveAddresses', () => {
    it('returns one ordered result per config matching the singular export', async () => {
        const configs = [
            multisig('first', 'p2wsh-multisig', 2, ['Alice', 'Bob', 'Carol']),
            multisig('second', 'p2sh-multisig', 1, ['Dana', 'Eli']),
        ];
        const h = harness(configs);
        const actual = await listMultisigReceiveAddresses(options(h));
        const expected = await Promise.all(configs.map(({ id }) => receiveMultisigAddress({
            ...options(h),
            multisigConfigId: id,
        })));

        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(configs.length);
        expect(actual.map(({ multisigConfigId }) => multisigConfigId)).toEqual(['first', 'second']);
    });

    it.each([
        { count: 0 },
        { count: -1 },
        { startIndex: -1 },
        { startIndex: 'invalid' },
        { count: 1, startIndex: 1 },
    ])('ignores unsupported range options $count $startIndex', async (range) => {
        const h = harness([
            multisig('first', 'p2wsh-multisig', 2, ['Alice', 'Bob']),
            multisig('second', 'p2wsh-multisig', 2, ['Carol', 'Dana']),
        ]);

        const result = await listMultisigReceiveAddresses({ ...options(h), ...range });

        expect(result.map(({ multisigConfigId }) => multisigConfigId)).toEqual(['first', 'second']);
        expect(h.deriveMultisigAddress).toHaveBeenCalledTimes(2);
    });

    it('returns an empty list when the wallet has no multisig configurations', async () => {
        const h = harness([]);

        await expect(listMultisigReceiveAddresses(options(h))).resolves.toEqual([]);
        expect(h.deriveMultisigAddress).not.toHaveBeenCalled();
    });

    it('returns an empty list when the wallet is absent', async () => {
        const h = harness([]);
        h.vault.wallets.get.mockResolvedValue(null);

        await expect(listMultisigReceiveAddresses(options(h))).resolves.toEqual([]);
        expect(h.sdkRegistry.get).not.toHaveBeenCalled();
    });
});
