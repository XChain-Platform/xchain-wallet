// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// signMultisigLocally signs for exactly one local cosigner, so a config
// with two of this wallet's own keys could be funded and never reach its
// threshold from inside the wallet. createMultisigConfig refuses it.

import { describe, it, expect, vi } from 'vitest';
import { createMultisigConfig } from '../../../packages/core/src/flows/createMultisigConfig.js';

const PK_A = '02'.padEnd(66, 'a');
const PK_B = '02'.padEnd(66, 'b');

function fakeVault() {
    const wallet = { id: 'w-1', name: 'Main', multisigs: [] };
    return {
        wallets: {
            get: vi.fn(async (id) => (id === 'w-1' ? wallet : null)),
            put: vi.fn(async () => {}),
        },
    };
}

function local(name, pubkey, path) {
    return { name, pubkey, fingerprint: '73c5da0a', origin: 'local', localSignerId: 'wallet:w-1', derivationPath: path };
}

function opts(cosigners, vault = fakeVault()) {
    return {
        vault,
        sdkRegistry: { get: () => null },
        chainId: 'bitcoin-testnet',
        walletId: 'w-1',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners,
    };
}

describe('createMultisigConfig local cosigners', () => {
    it('refuses a second local cosigner before touching the vault', async () => {
        const vault = fakeVault();
        await expect(createMultisigConfig(opts([
            local('Mine 1', PK_A, "m/84'/1'/0'/0/0"),
            local('Mine 2', PK_B, "m/84'/1'/0'/0/1"),
        ], vault))).rejects.toThrow(/only one cosigner can be this wallet's own key \(found 2\)/);
        expect(vault.wallets.put).not.toHaveBeenCalled();
    });

    it('accepts one local cosigner beside an external one', async () => {
        const vault = fakeVault();
        const { config } = await createMultisigConfig(opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            { name: 'Bob', pubkey: PK_B, fingerprint: '11223344', origin: 'external-xpub', xpub: 'xpub' + 'b'.repeat(107), derivationPath: "m/84'/1'/0'/0/0" },
        ], vault));
        expect(config.cosigners.filter((c) => c.origin === 'local')).toHaveLength(1);
        expect(vault.wallets.put).toHaveBeenCalledTimes(1);
    });
});
