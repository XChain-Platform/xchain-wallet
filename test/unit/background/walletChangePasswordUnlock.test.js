// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A password change, followed by the unlock that comes after it.
//
// Real crypto end to end: a real Vault over in-memory backends, real Argon2id
// (at demo cost), real wallet seals, and the real pre-host `wallet.unlock`
// handler the extension and desktop run. The question is the one the user
// asks the morning after: which password opens the wallet now?
//
// The vault document is sealed under a key derived from the password and the
// meta slot's kdfParams, and every wallet record's seed is sealed under its
// own derivation. A change that re-seals only the wallet record leaves the
// vault on the old password: the new password then fails at `vault.open()`
// and the old one still opens the vault, with the changed wallet silently
// dropped from the signer pool.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { changeWalletPassword } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { handleWalletUnlock } from '../../../packages/extension/src/background/walletUnlock.js';
import { createVaultKeyring } from '../../../packages/extension/src/background/vaultKeyring.js';
import { loadSigningCredentials, saveSigningSecret } from '../../../packages/extension/src/background/signingSecretSession.js';
import { storage as storageLib, crypto as cryptoLib, signers as signersLib } from '../../../packages/core/src/index.js';
import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { rekeyWalletRecord as realRekeyWalletRecord } from '../../../packages/core/src/flows/backupFile.js';
import { unlockWallet as realUnlockWallet } from '../../../packages/core/src/flows/unlockWallet.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const VAULT_KDF = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};
// A wallet added later carries its own salt, as importMnemonic gives it.
const OTHER_KDF = { ...VAULT_KDF, salt: 'AQEBAQEBAQEBAQEBAQEBAQ==' };

const MNEMONIC_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_B = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const OLD = 'old-wallet-password';
const NEW = 'new-wallet-password';
const OTHER = 'a-different-password';

// Copies bytes on save, as every real backend does (serialized to storage, or
// copied into the keychain backend's in-memory slot): callers zero their key
// buffers right after handing them over.
function memBackend() {
    let v = null;
    return {
        load: async () => v,
        save: async (next) => { v = next instanceof Uint8Array ? new Uint8Array(next) : next; },
        clear: async () => { v = null; },
    };
}

async function sealedWallet({ id, mnemonic, password, kdfParams }) {
    const sealed = await encryptWalletSeed({
        password,
        seed: new TextEncoder().encode(mnemonic),
        kdfParams,
    });
    return {
        ...createWallet({
            name: `Wallet ${id}`,
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id,
    };
}

/**
 * A vault as onboarding leaves it: meta holds the vault kdfParams, the blob is
 * sealed under OLD, the session slot holds the derived key and the signing
 * slot holds the password. Returns the live, open vault a host would hold.
 */
async function onboardedVault(walletSpecs) {
    const storageBackend = memBackend();
    const metaBackend = memBackend();
    const sessionBackend = memBackend();
    const signingSecretBackend = memBackend();
    await metaBackend.save({ kdfParams: VAULT_KDF });
    const key = cryptoLib.deriveMasterKey(OLD, VAULT_KDF);
    const vault = new storageLib.Vault({ backend: storageBackend, masterKey: key });
    await vault.open();
    for (const spec of walletSpecs) {
        await vault.wallets.put(await sealedWallet(spec));
    }
    await sessionBackend.save(new Uint8Array(key));
    await saveSigningSecret(signingSecretBackend, OLD);
    key.fill(0);
    return { vault, storageBackend, metaBackend, sessionBackend, signingSecretBackend };
}

function hostDeps(env, pool = new signersLib.SignerPool()) {
    return {
        vault: env.vault,
        chainRegistry: {},
        sdkRegistry: {},
        signerPool: pool,
        vaultKeyring: createVaultKeyring({
            metaBackend: env.metaBackend,
            sessionBackend: env.sessionBackend,
            signingSecretBackend: env.signingSecretBackend,
        }),
    };
}

/** What the next `wallet.unlock` with `password` does, in one line. */
async function unlockOutcome(env, password) {
    const pool = new signersLib.SignerPool();
    try {
        await handleWalletUnlock({ password }, {
            storageBackend: env.storageBackend,
            sessionBackend: memBackend(),
            metaBackend: env.metaBackend,
            signerPool: pool,
            chainRegistry: {},
            sdkRegistry: {},
        });
    } catch (err) {
        return `refused: ${err?.name}`;
    }
    const pooled = ['w1', 'w2'].filter((id) => pool.get(id));
    pool.lockAll();
    return `opened; signers for [${pooled.join(', ')}]`;
}

async function seedOpensUnder(env, walletId, password) {
    const key = cryptoLib.deriveMasterKey(password, (await env.metaBackend.load()).kdfParams);
    const v = new storageLib.Vault({ backend: env.storageBackend, masterKey: key });
    key.fill(0);
    try {
        await v.open();
    } catch {
        // The vault is not under this password; read the record through the
        // live handle instead, which is what a host would hold.
        const w = await env.vault.wallets.get(walletId);
        return decryptWalletSeed({ password, encryptedSeed: w.encryptedSeed, kdfParams: w.kdfParams })
            .then(() => true, () => false);
    }
    const w = await v.wallets.get(walletId);
    v.close();
    return decryptWalletSeed({ password, encryptedSeed: w.encryptedSeed, kdfParams: w.kdfParams })
        .then(() => true, () => false);
}

describe('wallet.changePassword, then wallet.unlock', () => {
    it('the new password opens the vault and the wallet; the old one opens nothing', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);

        const res = await changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env));
        expect(res).toMatchObject({ changed: true, vaultRekeyed: true });

        expect(await unlockOutcome(env, NEW)).toBe('opened; signers for [w1]');
        expect(await unlockOutcome(env, OLD)).toBe('refused: InvalidPasswordError');
    });

    it('keeps the KDF parameters, salt included, on the vault and on the wallet', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        await changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env));

        expect((await env.metaBackend.load()).kdfParams).toEqual(VAULT_KDF);
        expect((await env.vault.wallets.get('w1')).kdfParams).toEqual(VAULT_KDF);
    });

    it('re-seals every wallet the old password opened, and leaves a differently sealed one alone', async () => {
        const env = await onboardedVault([
            { id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF },
            { id: 'w2', mnemonic: MNEMONIC_B, password: OLD, kdfParams: OTHER_KDF },
        ]);
        await changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env));

        expect(await unlockOutcome(env, NEW)).toBe('opened; signers for [w1, w2]');
        expect(await seedOpensUnder(env, 'w2', OLD)).toBe(false);
        expect((await env.vault.wallets.get('w2')).kdfParams).toEqual(OTHER_KDF);
    });

    it('a wallet with its own password changes alone and the vault stays on its password', async () => {
        const env = await onboardedVault([
            { id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF },
            { id: 'w2', mnemonic: MNEMONIC_B, password: OTHER, kdfParams: OTHER_KDF },
        ]);
        const res = await changeWalletPassword(
            { walletId: 'w2', currentPassword: OTHER, newPassword: NEW }, hostDeps(env));
        expect(res).toMatchObject({ changed: true, vaultRekeyed: false });

        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1]');
        expect(await unlockOutcome(env, NEW)).toBe('refused: InvalidPasswordError');
        expect(await seedOpensUnder(env, 'w2', NEW)).toBe(true);
        expect(await seedOpensUnder(env, 'w2', OTHER)).toBe(false);
        expect(await seedOpensUnder(env, 'w1', OLD)).toBe(true);
    });

    it('moves the cached session key and signing password to the new password', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        await changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env));

        // A service-worker restart rebuilds the host from the session key and
        // re-pools from the signing slot; both must follow the change.
        const cachedKey = await env.sessionBackend.load();
        const v = new storageLib.Vault({ backend: env.storageBackend, masterKey: cachedKey });
        await expect(v.open()).resolves.toBeUndefined();
        v.close();
        const creds = await loadSigningCredentials(env.signingSecretBackend);
        expect(creds?.password === NEW).toBe(true);
    });

    it('re-pools the changed wallet in the live session under the new password', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        const pool = new signersLib.SignerPool();
        await changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env, pool));
        expect(pool.get('w1')).toBeTruthy();
        pool.lockAll();
    });

    it('a failed vault write changes nothing: the old password still opens the vault and the wallet', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        const realSave = env.storageBackend.save;
        env.storageBackend.save = async () => { throw new Error('disk full'); };

        await expect(changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env))).rejects.toThrow('disk full');
        env.storageBackend.save = realSave;

        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1]');
        expect(await unlockOutcome(env, NEW)).toBe('refused: InvalidPasswordError');
        // The live handle is still on the old key, so the session keeps writing.
        await env.vault.wallets.put({ ...(await env.vault.wallets.get('w1')), name: 'Renamed' });
        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1]');
        const creds = await loadSigningCredentials(env.signingSecretBackend);
        expect(creds?.password === OLD).toBe(true);
    });

    // Each re-seal costs an Argon2id derivation, so a change takes seconds, and
    // another window can write a wallet record meanwhile. Overwriting that
    // write loses it (an imported key would be gone); keeping it beside a
    // re-sealed vault leaves that record on the old password. Either way the
    // change must refuse and write nothing.
    it('refuses, writing nothing, when another wallet is renamed during the re-seal', async () => {
        const env = await onboardedVault([
            { id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF },
            { id: 'w2', mnemonic: MNEMONIC_B, password: OLD, kdfParams: OTHER_KDF },
        ]);
        let renamed = false;
        const rekeyWalletRecord = async (candidate, opts) => {
            if (!renamed) {
                renamed = true;
                await env.vault.wallets.put({ ...(await env.vault.wallets.get('w2')), name: 'Renamed meanwhile' });
            }
            return realRekeyWalletRecord(candidate, opts);
        };

        await expect(changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env), { rekeyWalletRecord },
        )).rejects.toMatchObject({ name: 'PasswordChangeConflictError' });

        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1, w2]');
        expect(await unlockOutcome(env, NEW)).toBe('refused: InvalidPasswordError');
        expect((await env.vault.wallets.get('w2')).name).toBe('Renamed meanwhile');
        const creds = await loadSigningCredentials(env.signingSecretBackend);
        expect(creds?.password === OLD).toBe(true);

        // Nothing is wedged: the same change goes through on the next try.
        await changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env));
        expect(await unlockOutcome(env, NEW)).toBe('opened; signers for [w1, w2]');
        expect((await env.vault.wallets.get('w2')).name).toBe('Renamed meanwhile');
    });

    it('refuses when the target itself is rewritten during the verification unlock', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        const unlockWallet = async (opts) => {
            await env.vault.wallets.put({ ...(await env.vault.wallets.get('w1')), name: 'Renamed meanwhile' });
            return realUnlockWallet(opts);
        };

        await expect(changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env), { unlockWallet },
        )).rejects.toMatchObject({ name: 'PasswordChangeConflictError' });

        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1]');
        expect((await env.vault.wallets.get('w1')).name).toBe('Renamed meanwhile');
    });

    it('two changes started together: one wins, the other refuses, and the caches follow the winner', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        const SECOND = 'second-new-password';
        const results = await Promise.allSettled([
            changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: NEW }, hostDeps(env)),
            changeWalletPassword({ walletId: 'w1', currentPassword: OLD, newPassword: SECOND }, hostDeps(env)),
        ]);
        const won = results.findIndex((r) => r.status === 'fulfilled');
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results[1 - won]).toMatchObject({ status: 'rejected', reason: { name: 'PasswordChangeConflictError' } });

        const winner = won === 0 ? NEW : SECOND;
        const loser = won === 0 ? SECOND : NEW;
        expect(await unlockOutcome(env, winner)).toBe('opened; signers for [w1]');
        expect(await unlockOutcome(env, loser)).toBe('refused: InvalidPasswordError');
        expect(await unlockOutcome(env, OLD)).toBe('refused: InvalidPasswordError');
        const cachedKey = await env.sessionBackend.load();
        const v = new storageLib.Vault({ backend: env.storageBackend, masterKey: cachedKey });
        await expect(v.open()).resolves.toBeUndefined();
        v.close();
        const creds = await loadSigningCredentials(env.signingSecretBackend);
        expect(creds?.password === winner).toBe(true);
    });

    it('refuses before any write when the shell gives no way to move the vault key', async () => {
        const env = await onboardedVault([{ id: 'w1', mnemonic: MNEMONIC_A, password: OLD, kdfParams: VAULT_KDF }]);
        const deps = { ...hostDeps(env), vaultKeyring: undefined };
        await expect(changeWalletPassword(
            { walletId: 'w1', currentPassword: OLD, newPassword: NEW }, deps)).rejects.toThrow(/cannot change/i);
        expect(await unlockOutcome(env, OLD)).toBe('opened; signers for [w1]');
    });
});
