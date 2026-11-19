// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The recovery-phrase reset through the real extension and desktop lanes
// (operator ruling 2026-11-16): `wallet.create` writes the wrap, `wallet.unlock`
// backfills it, `wallet.recovery.status` reports it, `wallet.recovery.resetWithPhrase`
// resets and unlocks (a wrong phrase writes nothing), and a password change keeps
// the reset working. Real AES and real vaults; the KDF is a fast stand-in that
// yields the same bytes for the same inputs, as in walletCreateDerivesOnce.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    const derive = (password, params) => {
        actual.validateKdfParams(params);
        const h = createHash('sha256');
        h.update(password);
        h.update(actual.base64ToBytes(params.salt));
        h.update(`${params.iterations}:${params.memory}:${params.parallelism}`);
        const out = new Uint8Array(h.digest());
        // Every derived key, so a test can follow one through the host.
        (globalThis.__laneDerivedKeys ??= []).push({ password, salt: params.salt, out, bytes: new Uint8Array(out) });
        return out;
    };
    return {
        ...actual,
        deriveMasterKey: derive,
        deriveMasterKeyAsync: async (password, params) => derive(password, params),
        calibrateKdfParamsAsync: async () => actual.makeFreshKdfParams(),
    };
});

const core = await import('@xchain-wallet/core');
const { dispatchPreHost } = await import('../../../packages/extension/src/background/sessionMeta.js');
const { changeWalletPassword, createBackgroundHost } = await import('../../../packages/extension/src/background/createBackgroundHost.js');
const { createVaultKeyring } = await import('../../../packages/extension/src/background/vaultKeyring.js');
const recoveryCrypto = await import('../../../packages/core/src/crypto/phraseRecovery.js');

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new password';

function memBackend() {
    let v = null;
    return {
        load: async () => (v instanceof Uint8Array ? new Uint8Array(v) : v),
        save: async (next) => { v = next instanceof Uint8Array ? new Uint8Array(next) : structuredClone(next); },
        clear: async () => { v = null; },
    };
}

function registries() {
    const chainRegistry = core.registry.defaultRegistry();
    const sdkRegistry = new core.sdk.SDKRegistry({
        chainRegistry,
        sdkFactory: ({ network }) => ({
            wallet: {
                deriveAddress: (publicKeyHex, opts) => core.sdk.mockDeriveAddress(network, opts?.type, publicKeyHex),
            },
        }),
    });
    return { chainRegistry, sdkRegistry };
}

function lane() {
    const pending = [];
    const deps = {
        storageBackend: new core.storage.InMemoryBackend(),
        sessionBackend: memBackend(),
        signingSecretBackend: memBackend(),
        metaBackend: memBackend(),
        ...registries(),
        onUnlocked: vi.fn(),
        onPhraseRecoveryReconcile: (p) => pending.push(p),
    };
    const settle = async () => {
        while (pending.length) await pending.shift();
    };
    const send = (type, request) => dispatchPreHost(type, request, deps);
    return { deps, send, settle };
}

async function createWallet(env) {
    const result = await env.send('wallet.create', {
        password: PASSWORD,
        activeChainIds: [core.registry.DEFAULT_ONBOARDING_CHAIN_IDS[0]],
    });
    await env.settle();
    return result;
}

/** Lock as the shell does: drop the session key and signing secret. */
async function lock(env) {
    await env.deps.sessionBackend.clear();
    await env.deps.signingSecretBackend.clear();
}

describe('recovery-phrase lanes (extension and desktop pre-host)', () => {
    it('wallet.create writes one wrap, and status reports a phrase reset', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        const meta = await env.deps.metaBackend.load();
        expect(meta.kdfParams).toBeTruthy();
        expect(core.flows.readPhraseRecovery(meta.phraseRecovery).entries).toHaveLength(1);
        expect(JSON.stringify(meta)).not.toContain(mnemonic.split(' ')[0] + ' ' + mnemonic.split(' ')[1]);
        await expect(env.send('wallet.recovery.status')).resolves.toEqual({ hasWallet: true, phraseReset: true });
    });

    it('wallet.unlock backfills a vault made before the wrap existed', async () => {
        const env = lane();
        await createWallet(env);
        const meta = await env.deps.metaBackend.load();
        delete meta.phraseRecovery;
        await env.deps.metaBackend.save(meta);
        await expect(env.send('wallet.recovery.status')).resolves.toEqual({ hasWallet: true, phraseReset: false });
        await lock(env);

        await env.send('wallet.unlock', { password: PASSWORD });
        await env.settle();
        await expect(env.send('wallet.recovery.status')).resolves.toEqual({ hasWallet: true, phraseReset: true });
    });

    it('a wrong phrase writes nothing; the right one resets, unlocks, and only the new password opens it', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        await lock(env);
        const blob = await env.deps.storageBackend.load();
        const meta = await env.deps.metaBackend.load();

        await expect(env.send('wallet.recovery.resetWithPhrase', {
            phrase: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
            newPassword: NEW_PASSWORD,
        })).rejects.toMatchObject({ name: 'RecoveryPhraseMismatchError' });
        expect(await env.deps.storageBackend.load()).toEqual(blob);
        expect(await env.deps.metaBackend.load()).toEqual(meta);
        expect(await env.deps.sessionBackend.load()).toBeNull();

        const reply = await env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: NEW_PASSWORD });
        await env.settle();
        expect(reply).toMatchObject({ unlocked: true, passwordReset: true, skippedWalletIds: [] });
        expect(await env.deps.sessionBackend.load()).toBeInstanceOf(Uint8Array);

        await lock(env);
        await expect(env.send('wallet.unlock', { password: PASSWORD })).rejects.toMatchObject({ name: 'InvalidPasswordError' });
        await expect(env.send('wallet.unlock', { password: NEW_PASSWORD })).resolves.toMatchObject({ unlocked: true });
        await env.settle();
        // The record followed the new key: the phrase resets it again.
        await lock(env);
        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: 'third password here' }))
            .resolves.toMatchObject({ unlocked: true });
    });

    it('refuses a reset while the wallet is unlocked', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        expect(await env.deps.sessionBackend.load()).toBeInstanceOf(Uint8Array);
        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: NEW_PASSWORD }))
            .rejects.toThrow(/already unlocked/);
    });

    it('a password change keeps the phrase reset working', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        const sessionKey = await env.deps.sessionBackend.load();
        const vault = new core.storage.Vault({ backend: env.deps.storageBackend, masterKey: sessionKey });
        await vault.open();
        const [wallet] = await vault.wallets.list();
        await changeWalletPassword({ walletId: wallet.id, currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, {
            vault,
            chainRegistry: env.deps.chainRegistry,
            sdkRegistry: env.deps.sdkRegistry,
            signerPool: new core.signers.SignerPool(),
            vaultKeyring: createVaultKeyring({
                metaBackend: env.deps.metaBackend,
                sessionBackend: env.deps.sessionBackend,
                signingSecretBackend: env.deps.signingSecretBackend,
            }),
        });
        vault.close();
        sessionKey.fill(0);
        await lock(env);

        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: 'third password here' }))
            .resolves.toMatchObject({ unlocked: true, passwordReset: true });
        await lock(env);
        await expect(env.send('wallet.unlock', { password: NEW_PASSWORD })).rejects.toMatchObject({ name: 'InvalidPasswordError' });
        await expect(env.send('wallet.unlock', { password: 'third password here' })).resolves.toMatchObject({ unlocked: true });
    });
});

// Security review of the Forgot Password recovery, 2026-11-16, through the
// host handlers the three shells share.
describe('recovery key rotation and key hygiene in the shared host', () => {
    const SECOND_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

    async function openSession(env) {
        const sessionKey = await env.deps.sessionBackend.load();
        const vault = new core.storage.Vault({ backend: env.deps.storageBackend, masterKey: sessionKey });
        await vault.open();
        return { vault, sessionKey };
    }

    function hostFor(env, vault) {
        return createBackgroundHost({
            vault,
            chainRegistry: env.deps.chainRegistry,
            sdkRegistry: env.deps.sdkRegistry,
            signerPool: new core.signers.SignerPool(),
            approvals: { request: async () => ({ approved: true }) },
            bridgeEvents: { emit() {} },
            getDiagnosticContext: () => ({}),
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
            vaultKeyring: createVaultKeyring({ metaBackend: env.deps.metaBackend }),
        });
    }

    async function sealedWallet(id, mnemonic, password, kdfParams) {
        const sealed = await core.crypto.encryptWalletSeed({ password, seed: new TextEncoder().encode(mnemonic), kdfParams });
        return {
            ...core.schemas.createWallet({
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

    async function recoveryKeyFrom(record, mnemonic, walletId) {
        const phraseKey = await recoveryCrypto.derivePhraseKey(mnemonic, record.kdfParams);
        const entry = walletId ? record.entries.find((e) => e.walletId === walletId) : record.entries[0];
        return recoveryCrypto.openRecoveryEntry(phraseKey, entry);
    }

    it('wallet.changePassword rotates the recovery key, and the phrase still resets', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        const before = core.flows.readPhraseRecovery((await env.deps.metaBackend.load()).phraseRecovery);
        const oldRk = await recoveryKeyFrom(before, mnemonic);
        expect(oldRk).not.toBeNull();

        const { vault, sessionKey } = await openSession(env);
        const [wallet] = await vault.wallets.list();
        await changeWalletPassword({ walletId: wallet.id, currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, {
            vault,
            chainRegistry: env.deps.chainRegistry,
            sdkRegistry: env.deps.sdkRegistry,
            signerPool: new core.signers.SignerPool(),
            vaultKeyring: createVaultKeyring({
                metaBackend: env.deps.metaBackend,
                sessionBackend: env.deps.sessionBackend,
                signingSecretBackend: env.deps.signingSecretBackend,
            }),
        });
        vault.close();
        sessionKey.fill(0);

        const after = core.flows.readPhraseRecovery((await env.deps.metaBackend.load()).phraseRecovery);
        expect(await recoveryCrypto.openRecoveryBundle(oldRk, after.bundle)).toBeNull();
        await lock(env);
        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: 'third password here' }))
            .resolves.toMatchObject({ unlocked: true, passwordReset: true });
    });

    it('wallet.remove drops the wallet and rotates the recovery key', async () => {
        const env = lane();
        const { mnemonic } = await createWallet(env);
        const { vault, sessionKey } = await openSession(env);
        const meta = await env.deps.metaBackend.load();
        const [first] = await vault.wallets.list();
        await vault.wallets.put(await sealedWallet('w-second', SECOND_MNEMONIC, PASSWORD, meta.kdfParams));
        await core.flows.reconcilePhraseRecoveryInMeta({
            metaBackend: env.deps.metaBackend, vault, vaultKey: sessionKey, password: PASSWORD,
        });
        const before = core.flows.readPhraseRecovery((await env.deps.metaBackend.load()).phraseRecovery);
        expect(before.entries.map((e) => e.walletId).sort()).toEqual([first.id, 'w-second'].sort());
        const oldRk = await recoveryKeyFrom(before, SECOND_MNEMONIC, 'w-second');
        expect(oldRk).not.toBeNull();

        const reply = await hostFor(env, vault).handle({ type: 'wallet.remove', request: { walletId: 'w-second' } });
        expect(reply.ok).toBe(true);

        const after = core.flows.readPhraseRecovery((await env.deps.metaBackend.load()).phraseRecovery);
        expect(after.entries.map((e) => e.walletId)).toEqual([first.id]);
        expect(await recoveryCrypto.openRecoveryBundle(oldRk, after.bundle)).toBeNull();
        vault.close();
        sessionKey.fill(0);
        await lock(env);
        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: SECOND_MNEMONIC, newPassword: NEW_PASSWORD }))
            .rejects.toMatchObject({ name: 'RecoveryPhraseMismatchError' });
        await expect(env.send('wallet.recovery.resetWithPhrase', { phrase: mnemonic, newPassword: NEW_PASSWORD }))
            .resolves.toMatchObject({ unlocked: true, passwordReset: true });
    });

    it('wallet.importBackup zeroes the lent re-seal key when the import fails after the re-seal', async () => {
        const env = lane();
        await createWallet(env);
        const { vault, sessionKey } = await openSession(env);
        const meta = await env.deps.metaBackend.load();

        const srcParams = core.crypto.makeFreshKdfParams();
        const srcVault = new core.storage.Vault({
            backend: new core.storage.InMemoryBackend(),
            masterKey: core.crypto.deriveMasterKey('source wallet password', srcParams),
        });
        await srcVault.open();
        const record = await sealedWallet('wallet-from-backup', SECOND_MNEMONIC, 'source wallet password', srcParams);
        await srcVault.wallets.put(record);
        const { fileContent } = await core.flows.exportBackupFile({
            vault: srcVault, walletId: 'wallet-from-backup', password: 'backup file password', kdfParams: core.crypto.makeFreshKdfParams(),
        });
        // The same wallet id already in the live vault: a 'fresh' import with
        // onConflict 'error' throws after the re-seal has lent its key.
        await vault.wallets.put({ ...record, name: 'Live copy' });

        globalThis.__laneDerivedKeys = [];
        const realFill = Uint8Array.prototype.fill;
        const zeroed = [];
        const spy = vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (value, ...rest) {
            if (value === 0 && this.length === 32) zeroed.push({ arr: this, bytes: Uint8Array.from(this) });
            return realFill.call(this, value, ...rest);
        });
        let reply;
        try {
            reply = await hostFor(env, vault).handle({
                type: 'wallet.importBackup',
                request: {
                    fileContent,
                    password: 'backup file password',
                    walletPassword: 'source wallet password',
                    devicePassword: PASSWORD,
                    onConflict: 'error',
                    mode: 'fresh',
                },
            });
        } finally {
            spy.mockRestore();
        }
        expect(reply.ok).toBe(false);
        expect(reply.error?.name).toBe('BackupConflictError');
        // The re-seal's key: the device password under the wallet's fresh salt.
        const reseal = globalThis.__laneDerivedKeys.filter((d) => d.password === PASSWORD && d.salt !== meta.kdfParams.salt);
        expect(reseal).toHaveLength(1);
        const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
        // The re-seal zeroes its own buffer last of all its copies (the AEAD
        // zeroes its working copies before that); a copy of the key zeroed
        // after that point is the host's lent copy.
        const resealZeroed = zeroed.findIndex((z) => z.arr === reseal[0].out);
        expect(resealZeroed).toBeGreaterThanOrEqual(0);
        const lentCopies = zeroed.slice(resealZeroed + 1)
            .filter((z) => z.arr !== reseal[0].out && same(z.bytes, reseal[0].bytes));
        expect(lentCopies.length).toBeGreaterThan(0);
        vault.close();
        sessionKey.fill(0);
    });
});
