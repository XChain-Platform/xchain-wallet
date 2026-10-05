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
const SEGWIT_TEMPLATE = `multi:2:${KEY_A}:${KEY_B}:${KEY_C}`;
const CLASSIC_TEMPLATE = `multi:1:${KEY_C}:${KEY_A}`;
const REQUIRED_OPTION_CASES = [
    ['vault', undefined, 'receiveMultisigAddress: vault is required'],
    ['sdkRegistry', undefined, 'receiveMultisigAddress: sdkRegistry is required'],
    ['walletId', '', 'receiveMultisigAddress: walletId is required'],
    ['chainId', '', 'receiveMultisigAddress: chainId is required'],
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
        scriptTemplate: SEGWIT_TEMPLATE,
        ...overrides,
    };
}

function harness(configs = [config()], deriveMultisigAddress = vi.fn()) {
    const wallet = { id: 'wallet-1', multisigs: configs };
    const vault = { wallets: { get: vi.fn().mockResolvedValue(wallet) } };
    const sdkRegistry = { get: vi.fn().mockReturnValue({ deriveMultisigAddress }) };
    return { vault, sdkRegistry, walletId: wallet.id, chainId: 'bitcoin-testnet' };
}

it('returns a deterministic address and metadata from the default config', async () => {
    const derived = { address: 'tb1qdeterministic', witnessScript: '52210211ae' };
    const derive = vi.fn().mockReturnValue(derived);
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
    expect(derive).toHaveBeenNthCalledWith(1, {
        scriptTemplate: SEGWIT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
    expect(derive).toHaveBeenNthCalledWith(2, {
        scriptTemplate: SEGWIT_TEMPLATE, scheme: 'p2wsh-multisig',
    });
});

it('selects the requested config and forwards its exact derivation fields', async () => {
    const selected = config({
        id: 'config-2', scheme: 'p2sh-multisig', threshold: 1,
        cosigners: [cosigner('Carol', KEY_C), cosigner('Alice', KEY_A)],
        scriptTemplate: CLASSIC_TEMPLATE,
    });
    const derive = vi.fn().mockReturnValue({
        address: '2Nselected', redeemScript: '51210211ae',
    });
    const opts = harness([config(), selected], derive);

    const result = await receiveMultisigAddress({ ...opts, multisigConfigId: 'config-2' });

    expect(derive).toHaveBeenCalledOnce();
    expect(derive).toHaveBeenCalledWith({
        scriptTemplate: CLASSIC_TEMPLATE, scheme: 'p2sh-multisig',
    });
    expect(result).toMatchObject({
        multisigConfigId: 'config-2', address: '2Nselected',
        scheme: 'p2sh-multisig', threshold: 1, cosignerCount: 2,
        schemeLabel: '1-of-2 Classic multi-signature',
    });
});

it.each(REQUIRED_OPTION_CASES)('rejects a missing %s option', async (key, value, message) => {
    const opts = harness();
    opts[key] = value;

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(message);
});

it('rejects a wallet that does not exist', async () => {
    const opts = harness();
    opts.vault.wallets.get.mockResolvedValue(undefined);

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(
        'receiveMultisigAddress: wallet "wallet-1" not found',
    );
    expect(opts.vault.wallets.get).toHaveBeenCalledWith('wallet-1');
});

it('rejects an unknown multisig config id', async () => {
    const opts = harness();

    await expect(receiveMultisigAddress({
        ...opts, multisigConfigId: 'missing-config',
    })).rejects.toThrow(
        'receiveMultisigAddress: wallet "wallet-1" has no multisig config with id "missing-config"',
    );
});

it('rejects a wallet with no multisig config', async () => {
    const opts = harness([]);

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(
        'receiveMultisigAddress: wallet "wallet-1" has no multisig configuration',
    );
});

it('rejects a chain with no registered SDK', async () => {
    const opts = harness();
    opts.sdkRegistry.get.mockReturnValue(undefined);

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(
        'receiveMultisigAddress: no SDK registered for chainId "bitcoin-testnet"',
    );
    expect(opts.sdkRegistry.get).toHaveBeenCalledWith('bitcoin-testnet');
});

it('rejects an SDK without multisig address derivation', async () => {
    const opts = harness();
    opts.sdkRegistry.get.mockReturnValue({});

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(
        'receiveMultisigAddress: sdk.deriveMultisigAddress is unavailable',
    );
});

it('rejects an empty address returned by the SDK', async () => {
    const derive = vi.fn().mockReturnValue({ address: '' });
    const opts = harness([config()], derive);

    await expect(receiveMultisigAddress(opts)).rejects.toThrow(
        'receiveMultisigAddress: SDK returned no address',
    );
    expect(derive).toHaveBeenCalledOnce();
});
