// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { expect, it, vi } from 'vitest';
import { receiveMultisigAddress } from '../../../packages/core/src/flows/multisigAddress.js';

const KEY_A = `02${'11'.repeat(32)}`;
const KEY_B = `03${'22'.repeat(32)}`;
const KEY_C = `02${'33'.repeat(32)}`;
const SCRIPT_TEMPLATE = `multi:2:${KEY_A}:${KEY_B}:${KEY_C}`;
const REJECTION_CASES = [
    {
        label: 'a threshold above the cosigner count',
        overrides: { threshold: 4, scriptTemplate: `multi:4:${KEY_A}:${KEY_B}:${KEY_C}` },
        message: 'deriveMultisigAddress: threshold exceeds key count',
    },
    {
        label: 'an invalid public key',
        overrides: { scriptTemplate: `multi:2:${KEY_A}:not-a-key:${KEY_C}` },
        message: 'deriveMultisigAddress: invalid compressed public key',
    },
];

function cosigner(name, pubkey) {
    return { name, pubkey };
}

function config(overrides = {}) {
    return {
        id: 'config-1',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners: [
            cosigner('Alice', KEY_A),
            cosigner('Bob', KEY_B),
            cosigner('Carol', KEY_C),
        ],
        scriptTemplate: SCRIPT_TEMPLATE,
        ...overrides,
    };
}

function harness(configs, deriveMultisigAddress) {
    const wallet = { id: 'wallet-1', multisigs: configs };
    const vault = { wallets: { get: vi.fn().mockResolvedValue(wallet) } };
    const sdkRegistry = { get: vi.fn().mockReturnValue({ deriveMultisigAddress }) };
    return { vault, sdkRegistry, walletId: wallet.id, chainId: 'bitcoin-testnet' };
}

it('returns the deterministic address and multisig metadata', async () => {
    const derive = vi.fn().mockReturnValue({
        address: 'tb1qdeterministic',
        witnessScript: '52210211ae',
    });
    const opts = harness([config()], derive);

    const first = await receiveMultisigAddress(opts);
    const second = await receiveMultisigAddress(opts);

    expect(first).toEqual({
        multisigConfigId: 'config-1', address: 'tb1qdeterministic',
        scheme: 'p2wsh-multisig', threshold: 2, cosignerCount: 3,
        cosignerNames: ['Alice', 'Bob', 'Carol'],
        schemeLabel: '2-of-3 SegWit multi-signature (lower fees)',
        redeemScript: null, witnessScript: '52210211ae', outputPubkey: null,
    });
    expect(second).toEqual(first);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(derive).toHaveBeenLastCalledWith({
        scriptTemplate: SCRIPT_TEMPLATE,
        scheme: 'p2wsh-multisig',
    });
});

it('derives the same address from a canonical script template after cosigner reordering', async () => {
    const derive = vi.fn().mockReturnValue({ address: 'tb1qdeterministic' });
    const reordered = config({
        id: 'config-2',
        cosigners: [
            cosigner('Carol', KEY_C),
            cosigner('Alice', KEY_A),
            cosigner('Bob', KEY_B),
        ],
    });
    const opts = harness([config(), reordered], derive);

    const original = await receiveMultisigAddress(opts);
    const result = await receiveMultisigAddress({ ...opts, multisigConfigId: 'config-2' });

    expect(result.address).toBe(original.address);
    expect(derive).toHaveBeenNthCalledWith(1, {
        scriptTemplate: SCRIPT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
    expect(derive).toHaveBeenNthCalledWith(2, {
        scriptTemplate: SCRIPT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
});

it.each(REJECTION_CASES)('propagates the SDK error for $label', async ({ overrides, message }) => {
    const derive = vi.fn().mockImplementation(() => { throw new Error(message); });
    const opts = harness([config(overrides)], derive);

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(message);
    expect(derive).toHaveBeenCalledWith({
        scriptTemplate: overrides.scriptTemplate, scheme: 'p2wsh-multisig',
    });
});
