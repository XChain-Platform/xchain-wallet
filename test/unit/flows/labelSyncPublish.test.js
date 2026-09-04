// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6 / §19.5.2: `publishLabelsNow` derives the seed that produces the
// commitment key OUTSIDE the signer, so it has to read the stored BIP39
// passphrase itself instead of trusting a caller-supplied one. Since the
// unlock screen stopped collecting a passphrase, a wallet that still
// derived from the caller's (now always-empty) string would silently
// compute the WRONG commitment key and publish labels under the wrong
// on-chain identity - no error, no crash, just a payload nobody's restore
// will ever find.
//
// These cases build a REAL wallet through `persistHdWallet` (the seam that
// captures and seals the passphrase at setup) against a real Vault, then
// call `publishLabelsNow` and check the discovery name it actually
// published under against one independently derived from the mnemonic +
// the stored passphrase. `submitAction` is mocked: what's under test is
// the seed/commitment-key derivation, not chain submission.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { publishLabelsNow } from '../../../packages/core/src/flows/labelSync.js';
import { persistHdWallet } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
} from '../../../packages/core/src/crypto/labelSync.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'txid-1' })),
}));
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

// Captures set by the wrapped decryptWalletPassphrase below, read back
// after a publishLabelsNow call to check the zeroing guarantee.
const captured = vi.hoisted(() => ({ masterKey: null, passphraseBytes: null }));

vi.mock('../../../packages/core/src/crypto/walletBlob.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        decryptWalletPassphrase: vi.fn(async (args) => {
            // A reference to the caller's copy, so the test can tell if
            // publishLabelsNow zeroed it after use.
            captured.masterKey = args.masterKey;
            const bytes = await actual.decryptWalletPassphrase(args);
            captured.passphraseBytes = bytes;
            return bytes;
        }),
    };
});

// Every case pays a real Argon2id derivation (wallet create + publish's
// own decrypt), at a deliberately low test cost, not the production floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const PASSWORD = 'correct-horse-battery-staple';
const CHAIN_ID = 'btc-regtest';

// Below the production floor on purpose: what is under test is the
// passphrase-source wiring, not Argon2id's cost.
const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

// A fixed source address for the FILE tx. Address SELECTION is not this
// row's concern (it comes straight off the vault's Address records,
// unaffected by the seed-derivation bug), so `pickFromAddress` overrides
// `defaultPickFromAddress` entirely and no Address/Account records are
// ever written to the vault.
const FROM_ADDRESS = {
    id: 'addr-1',
    address: 'bcrt1qexample',
    publicKey: '02'.padEnd(66, 'ab'),
    derivationPath: "m/84'/1'/0'/0/0",
};

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    return vault;
}

async function makeWallet(vault, { passphraseEnabled, bip39Passphrase = '' } = {}) {
    const mnemonic = generateBip39Mnemonic(128);
    const { wallet } = await persistHdWallet({
        mnemonic,
        format: 'bip39',
        origin: 'created',
        passphraseEnabled,
        bip39Passphrase,
        password: PASSWORD,
        name: 'Test Wallet',
        accountName: 'Main',
        kdfParams: LOW_COST_KDF_PARAMS,
        vault,
        chainRegistry: {},
        sdkRegistry: {},
        // Empty on purpose: address derivation across real chains is not
        // part of this seam (pickFromAddress overrides selection below).
        activeChainIds: [],
    });
    return { wallet, mnemonic };
}

function discoveryNameForSeed(seed) {
    const key = computeLabelSyncCommitmentKey(seed);
    try {
        return computeLabelSyncDiscoveryName(key);
    } finally {
        key.fill(0);
    }
}

async function discoveryNameForPassphrase(mnemonic, passphrase) {
    const { bip39MnemonicToSeed } = await import('../../../packages/core/src/crypto/mnemonic.js');
    const seed = await bip39MnemonicToSeed(mnemonic, passphrase);
    try {
        return discoveryNameForSeed(seed);
    } finally {
        seed.fill(0);
    }
}

function publish(vault, walletId, overrides = {}) {
    return publishLabelsNow({
        vault,
        walletId,
        password: PASSWORD,
        chainId: CHAIN_ID,
        chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
        sdkRegistry: {},
        pickFromAddress: async () => FROM_ADDRESS,
        ...overrides,
    });
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'txid-1' });
    captured.masterKey = null;
    captured.passphraseBytes = null;
});

describe('publishLabelsNow: stored passphrase (§15.6) drives the commitment key', () => {
    it('AT7.1: publishes under the address the wallet itself derives, not the passphrase-less one', async () => {
        const vault = await openVault();
        const storedPassphrase = 'the fifth element';
        const { wallet, mnemonic } = await makeWallet(vault, {
            passphraseEnabled: true,
            bip39Passphrase: storedPassphrase,
        });
        expect(wallet.encryptedPassphrase).toEqual(expect.any(String));

        // Real caller shape post-migration: no bip39Passphrase collected.
        const result = await publish(vault, wallet.id);

        const correctName = await discoveryNameForPassphrase(mnemonic, storedPassphrase);
        const wrongName = await discoveryNameForPassphrase(mnemonic, '');

        expect(result.discoveryName).toBe(correctName);
        expect(result.discoveryName).not.toBe(wrongName);
    });

    it('AT7.2: a caller-supplied bip39Passphrase that differs from the stored one changes nothing', async () => {
        const vault = await openVault();
        const storedPassphrase = 'the fifth element';
        const { wallet, mnemonic } = await makeWallet(vault, {
            passphraseEnabled: true,
            bip39Passphrase: storedPassphrase,
        });

        const result = await publish(vault, wallet.id, {
            bip39Passphrase: 'a stale or attacker-supplied value',
        });

        const correctName = await discoveryNameForPassphrase(mnemonic, storedPassphrase);
        expect(result.discoveryName).toBe(correctName);
    });

    it('AT7.3: a no-passphrase wallet is unaffected', async () => {
        const vault = await openVault();
        const { wallet, mnemonic } = await makeWallet(vault, { passphraseEnabled: false });
        expect(wallet.encryptedPassphrase).toBeNull();

        const result = await publish(vault, wallet.id);

        const expectedName = await discoveryNameForPassphrase(mnemonic, '');
        expect(result.discoveryName).toBe(expectedName);
        // No stored passphrase exists, so the decrypt-passphrase path must
        // never even run.
        expect(captured.passphraseBytes).toBeNull();
    });

    it('zeroes both the retained master key and the decrypted passphrase bytes', async () => {
        const vault = await openVault();
        const { wallet } = await makeWallet(vault, {
            passphraseEnabled: true,
            bip39Passphrase: 'the fifth element',
        });

        await publish(vault, wallet.id);

        expect(captured.masterKey).not.toBeNull();
        expect(captured.passphraseBytes).not.toBeNull();
        expect(captured.masterKey.every((b) => b === 0)).toBe(true);
        expect(captured.passphraseBytes.every((b) => b === 0)).toBe(true);
    });

    it('never asks submitAction to sign with the caller-supplied passphrase override result', async () => {
        // Regression guard: the commitment key must come from the stored
        // value even though submitAction (the signer path, a separate
        // seam) still receives whatever bip39Passphrase the caller passed.
        const vault = await openVault();
        const storedPassphrase = 'the fifth element';
        const { wallet, mnemonic } = await makeWallet(vault, {
            passphraseEnabled: true,
            bip39Passphrase: storedPassphrase,
        });

        await publish(vault, wallet.id, { bip39Passphrase: 'typed-but-ignored' });

        const correctName = await discoveryNameForPassphrase(mnemonic, storedPassphrase);
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.params.NAME).toBe(correctName);
    });
});
