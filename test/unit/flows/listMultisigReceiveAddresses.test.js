// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { expect, it, vi } from 'vitest';
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

it('skips a config whose address derivation throws', async () => {
    const configs = [
        multisig('first', 'p2wsh-multisig', 2, ['Alice', 'Bob']),
        multisig('broken', 'p2wsh-multisig', 2, ['Carol', 'Dana']),
        multisig('third', 'p2sh-multisig', 1, ['Eli', 'Fran']),
    ];
    const h = harness(configs);
    h.deriveMultisigAddress.mockImplementation(({ scriptTemplate }) => {
        if (scriptTemplate === 'broken-template') throw new Error('cannot derive');
        return { address: `${scriptTemplate}-address` };
    });

    const result = await listMultisigReceiveAddresses(options(h));

    expect(result.map(({ multisigConfigId }) => multisigConfigId)).toEqual(['first', 'third']);
    expect(h.deriveMultisigAddress).toHaveBeenCalledTimes(3);
});

it.each([
    [undefined, 'opts is required'],
    [{}, 'vault is required'],
    [{ vault: {} }, 'sdkRegistry is required'],
    [{ vault: {}, sdkRegistry: {} }, 'walletId is required'],
    [{ vault: {}, sdkRegistry: {}, walletId: 'wallet-1' }, 'chainId is required'],
])('rejects invalid required arguments %#', async (opts, message) => {
    await expect(listMultisigReceiveAddresses(opts)).rejects.toThrow(message);
});
