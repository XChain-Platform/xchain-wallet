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

function deriveFixture({ scriptTemplate, scheme }) {
    const isExpectedInput = scriptTemplate === SCRIPT_TEMPLATE && scheme === 'p2wsh-multisig';
    return isExpectedInput
        ? { address: 'tb1qdeterministic', witnessScript: '52210211ae' }
        : { address: 'tb1qinputchanged', witnessScript: 'unexpected' };
}

function validatingDerive({ scriptTemplate }) {
    const [, thresholdText, ...keys] = scriptTemplate.split(':');
    if (Number(thresholdText) > keys.length) {
        throw new Error('deriveMultisigAddress: threshold exceeds key count');
    }
    if (keys.some((key) => !/^(02|03)[0-9a-f]{64}$/.test(key))) {
        throw new Error('deriveMultisigAddress: invalid compressed public key');
    }
    return { address: 'tb1qvalid' };
}

it('returns the deterministic address and multisig metadata', async () => {
    const derive = vi.fn(deriveFixture);
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

it('uses the persisted script template when cosigner metadata is reordered', async () => {
    const derive = vi.fn(deriveFixture);
    const reorderedTemplate = `multi:2:${KEY_C}:${KEY_A}:${KEY_B}`;
    const reordered = config({
        id: 'config-2',
        cosigners: [
            cosigner('Carol', KEY_C),
            cosigner('Alice', KEY_A),
            cosigner('Bob', KEY_B),
        ],
    });
    const opts = harness([config(), reordered], derive);
    const changed = derive({
        scriptTemplate: reorderedTemplate, scheme: 'p2wsh-multisig',
    });
    expect(changed.address).toBe('tb1qinputchanged');
    derive.mockClear();

    const original = await receiveMultisigAddress(opts);
    const result = await receiveMultisigAddress({ ...opts, multisigConfigId: 'config-2' });

    expect(result.address).toBe(original.address);
    expect(result.cosignerNames).toEqual(['Carol', 'Alice', 'Bob']);
    expect(derive).toHaveBeenNthCalledWith(1, {
        scriptTemplate: SCRIPT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
    expect(derive).toHaveBeenNthCalledWith(2, {
        scriptTemplate: SCRIPT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
});

it.each(REJECTION_CASES)('propagates the SDK error for $label', async ({ overrides, message }) => {
    const derive = vi.fn(validatingDerive);
    const opts = harness([config(overrides)], derive);

    expect(() => derive({ scriptTemplate: SCRIPT_TEMPLATE })).not.toThrow();
    derive.mockClear();
    await expect(receiveMultisigAddress(opts)).rejects.toThrow(message);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledWith({
        scriptTemplate: overrides.scriptTemplate, scheme: 'p2wsh-multisig',
    });
});
