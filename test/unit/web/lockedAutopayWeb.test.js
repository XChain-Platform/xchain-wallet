// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B on the web shell: a lock with an armed auto pay order hands
// the vault and the order's sealed key to the locked session, which keeps
// paying while the tab is open; every manual route answers "wallet is locked";
// nothing about the session reaches sessionStorage or localStorage; the
// Locked screen reads plain status and stops it with no password; an unlock
// ends it. Real vault, real signer pool and real WebCrypto sealing; the KDF,
// the storage backends and the watcher modules are stand-ins (the auto pay
// watcher is inert, so nothing polls the network).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({ storageBlob: null, meta: null }));

function fakeKey(password, params, base64ToBytes) {
    const h = createHash('sha256');
    h.update('fake-argon2id\0');
    h.update(password);
    h.update('\0');
    h.update(base64ToBytes(params.salt));
    h.update(`\0${params.iterations}\0${params.memory}\0${params.parallelism}`);
    return new Uint8Array(h.digest());
}

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKeyAsync: async (password, params) => {
            actual.validateKdfParams(params);
            return fakeKey(password, params, actual.base64ToBytes);
        },
        deriveMasterKey: () => { throw new Error('sync KDF reached in a web lane'); },
    };
});

const InertModuleWatcher = vi.hoisted(() => class {
    async start() {}
    stop() {}
    refresh() { return Promise.resolve(); }
});
vi.mock('../../../packages/core/src/notifications/NotificationService.js', () => ({ NotificationService: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/PriceAlertWatcher.js', () => ({ PriceAlertWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/GovernancePollWatcher.js', () => ({ GovernancePollWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js', () => ({ CoinpayAutopayWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/DeadlineWatcher.js', () => ({ DeadlineWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/DispenserEscrowWatcher.js', () => ({ DispenserEscrowWatcher: InertModuleWatcher }));

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({
        load: async () => state.storageBlob,
        save: async (blob) => { state.storageBlob = blob; },
        clear: async () => { state.storageBlob = null; },
    }),
    createMetaBackend: () => ({
        load: async () => state.meta,
        save: async (m) => { state.meta = m; },
        clear: async () => { state.meta = null; },
    }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const core = await import('@xchain-wallet/core');
const kdf = await import('../../../packages/core/src/crypto/kdf.js');
const { defaultRegistry } = await import('../../../packages/core/src/registry/index.js');
const { createAutopayOrder } = await import('../../../packages/core/src/schemas/autopayOrder.js');
const {
    importMnemonicLocal,
    unlockWalletLocal,
    lockWalletLocal,
    sendMessage,
    getLockedAutopayStatus,
    stopLockedAutopay,
} = await import('../../../packages/web/src/hostBridge.js');

const PASSWORD = 'correct horse battery';
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Write one armed auto pay consent for the wallet's first HD address, through a second Vault. */
async function armOneOrder() {
    const vaultKey = fakeKey(PASSWORD, state.meta.kdfParams, kdf.base64ToBytes);
    const v = new core.storage.Vault({
        backend: { load: async () => state.storageBlob, save: async (b) => { state.storageBlob = b; } },
        masterKey: vaultKey,
    });
    vaultKey.fill(0);
    await v.open();
    const [wallet] = await v.wallets.list();
    const registry = defaultRegistry();
    const chainId = registry.chainIdFor('bitcoin', 'regtest');
    expect(registry.get(chainId)).toBeTruthy();
    // The dev-mock SDK derives no real addresses, so the order's source is a
    // record written here with a real HD path the pooled signer can derive.
    // A derived (hd) record names the wallet account it was derived under.
    const [account] = (await v.accounts.list()).filter((a) => a.walletId === wallet.id);
    await v.addresses.put(core.schemas.createAddress({
        accountId: account.id,
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        address: 'bcrt1qfixturesourceaddress',
        publicKey: '02'.padEnd(66, 'a'),
    }));
    await v.autopayOrders.put(createAutopayOrder({
        walletId: wallet.id,
        chainId,
        sourceAddress: 'bcrt1qfixturesourceaddress',
        txid: 'ab'.repeat(32),
        giveCoinAmount: '0.05',
        getTick: 'PEPE',
        getAmount: '1000',
        autopay: true,
    }));
    await v.save();
    v.close();
    return { chainId };
}

let local;
let session;

beforeEach(async () => {
    await lockWalletLocal();
    state.storageBlob = null;
    state.meta = null;
    local = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() };
    session = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() };
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 0));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.stubGlobal('fetch', async () => { throw new Error('offline unit test'); });
});

afterEach(async () => {
    await stopLockedAutopay();
    await lockWalletLocal();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('web locked auto pay', () => {
    it('a lock with nothing armed runs as before', async () => {
        await importMnemonicLocal({ password: PASSWORD, mnemonic: PHRASE });
        await lockWalletLocal();
        expect(getLockedAutopayStatus()).toEqual({ active: false });
    });

    it('lock keeps armed auto pay running, refuses manual routes, keeps storage clean; Stop and unlock end it', async () => {
        await importMnemonicLocal({ password: PASSWORD, mnemonic: PHRASE });
        await lockWalletLocal();
        await armOneOrder();
        await unlockWalletLocal({ password: PASSWORD });

        vi.stubGlobal('localStorage', local);
        vi.stubGlobal('sessionStorage', session);
        await lockWalletLocal();

        const status = getLockedAutopayStatus();
        expect(status).toMatchObject({ active: true, orders: 1 });
        expect(status.caps[0].amount).toBe('0.05');
        expect(Object.keys(status).sort()).toEqual(['active', 'caps', 'orders']);
        expect(local.setItem).not.toHaveBeenCalled();
        expect(session.setItem).not.toHaveBeenCalled();

        for (const type of ['action.send', 'action.coinpay', 'auth.signMessage', 'wallet.exportPrivateKey']) {
            await expect(sendMessage(type, {})).rejects.toMatchObject({ name: 'VaultClosedError' });
        }

        // Unlock ends it (the next lock would start a fresh one).
        await unlockWalletLocal({ password: PASSWORD });
        expect(getLockedAutopayStatus()).toEqual({ active: false });

        await lockWalletLocal();
        expect(getLockedAutopayStatus().active).toBe(true);
        await expect(stopLockedAutopay()).resolves.toEqual({ active: false });
    });
});
