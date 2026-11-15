// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Used-address discovery runs with the wallet's seed signer, which cannot
// derive a hardware account's keys. A Trezor account inside the wallet must
// stay out of the scan in every wallet format: in a legacy wallet the seed
// signer refuses any account but 0 and the chain would read as failed, and
// in a BIP39 wallet it would derive seed keys at the hardware account's index.

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateBip39Mnemonic } from '../../../../packages/core/src/crypto/mnemonic.js';
import { defaultRegistry } from '../../../../packages/core/src/registry/index.js';
import { createAccount } from '../../../../packages/core/src/schemas/account.js';
import { createAddress } from '../../../../packages/core/src/schemas/address.js';
import { adaptXChainSDK } from '../../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../../packages/core/src/sdk/SDKRegistry.js';
import { Vault } from '../../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../../packages/core/src/storage/backend.js';
import { importMnemonic } from '../../../../packages/core/src/flows/importMnemonic.js';
import { unlockWallet } from '../../../../packages/core/src/flows/unlockWallet.js';
import { _resetBatchSupportMemo } from '../../../../packages/core/src/flows/balances.js';
import {
    discoverWalletAddresses,
    discoveryChainIds,
} from '../../../../packages/core/src/flows/walletAddressDiscovery.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const PASSWORD = 'discovery-hw-test-pw';
const LEGACY_MNEMONIC = 'explode gaze wolf admit nice charm except three any guitar into color';
const KDF = { algorithm: 'argon2id', salt: Buffer.alloc(16, 7).toString('base64'), iterations: 1, memory: 8192, parallelism: 1 };

function unusedBody(address) {
    return {
        balances: { data: [], total: 0 },
        address: {
            address,
            balances: { confirmed: '0', pending: '0', received: '0' },
            utxos: { confirmed: 0, pending: 0 },
            tracker_available: true,
        },
    };
}

const explorerSdk = {
    async getBalancesBatch(addresses) {
        return Object.fromEntries(addresses.map((address) => [address, unusedBody(address)]));
    },
};

// A restored wallet plus a Trezor account at index 1 holding p2pkh
// receive addresses on its own m/44' branch.
async function walletWithTrezorAccount({ mnemonic, format }) {
    const chainRegistry = defaultRegistry();
    const sdkRegistry = new SDKRegistry({ chainRegistry, sdkFactory: adaptXChainSDK(XChainSDK), rateLimiter: null });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: randomBytes(32), autoSave: false });
    await vault.open();
    const r = await importMnemonic({
        password: PASSWORD, mnemonic, format, vault, chainRegistry, sdkRegistry,
        activeChainIds: [CHAIN_ID], kdfParams: KDF,
    });
    const signer = await unlockWallet({ vault, walletId: r.wallet.id, password: PASSWORD, chainRegistry, sdkRegistry });
    const [first] = await vault.addresses.list();
    const trezorAccount = createAccount({ walletId: r.wallet.id, name: 'Trezor', index: 1 });
    await vault.accounts.put(trezorAccount);
    for (const i of [0, 1, 2]) {
        await vault.addresses.put(createAddress({
            accountId: trezorAccount.id, chain: first.chain, network: first.network,
            source: 'trezor', addressType: 'p2pkh', derivationPath: `m/44'/1'/1'/0/${i}`,
            address: `trezor-p2pkh-${i}`, publicKey: `trezor-pub-${i}`, signerId: 'trezor-signer',
        }));
    }
    const calls = [];
    const recording = {
        id: signer.id,
        kind: signer.kind,
        getAddresses: (opts) => {
            calls.push(opts);
            return signer.getAddresses(opts);
        },
    };
    return { chainRegistry, vault, walletId: r.wallet.id, signer: recording, calls };
}

beforeEach(() => _resetBatchSupportMemo());

describe('discoverWalletAddresses with a hardware account', () => {
    it.each([
        ['counterwallet-legacy', LEGACY_MNEMONIC],
        ['bip39', null],
    ])('never derives the hardware account with the seed signer in a %s wallet', async (format, phrase) => {
        const w = await walletWithTrezorAccount({ mnemonic: phrase ?? generateBip39Mnemonic(128), format });

        const result = await discoverWalletAddresses({
            vault: w.vault, walletId: w.walletId, signer: w.signer,
            chainRegistry: w.chainRegistry, sdkRegistry: { get: () => explorerSdk }, gapLimit: 2,
        });

        expect(result.chains.map((c) => c.status)).toEqual(['complete']);
        expect(w.calls.length).toBeGreaterThan(0);
        expect(w.calls.every((c) => c.accountIndex === 0)).toBe(true);
    });

    it('lists no chain for a wallet whose only addresses belong to a hardware account', async () => {
        const w = await walletWithTrezorAccount({ mnemonic: LEGACY_MNEMONIC, format: 'counterwallet-legacy' });
        for (const a of await w.vault.addresses.list()) {
            if (a.source === 'hd') await w.vault.addresses.delete(a.id);
        }

        await expect(discoveryChainIds({
            vault: w.vault, walletId: w.walletId, chainRegistry: w.chainRegistry,
        })).resolves.toEqual([]);
    });
});
