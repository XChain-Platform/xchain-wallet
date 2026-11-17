// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B through the shared pre-host dispatcher (extension service
// worker and desktop main both route through it). A wallet.lock with an armed
// auto pay order still clears the cached session key and the cached password
// from chrome.storage.session, and the session holds its key in memory only;
// the Locked screen's status and Stop are pre-host, trusted-sender types; any
// unlock, create or import ends locked auto pay before it opens a vault. The
// fixture key string is not a key and is never printed.

import { describe, expect, it, vi } from 'vitest';
import { dispatchPreHost, PRE_HOST_MESSAGE_TYPES } from '../../../packages/extension/src/background/sessionMeta.js';
import { createLockBackstop } from '../../../packages/extension/src/background/walletLock.js';
import { createLockedAutopay } from '../../../packages/core/src/market/autopaySession.js';
import { isMessageAllowedFromSender, isPublicBridgeType } from '../../../packages/extension/src/bridge/publicSurface.js';

const FIXTURE_KEY = 'fixture-sealed-value-not-a-key';

// A chrome.storage.session stand-in that records every value written.
function sessionArea() {
    const data = new Map();
    return {
        data,
        backend(key) {
            return {
                load: vi.fn(async () => data.get(key) ?? null),
                save: vi.fn(async (v) => { data.set(key, v); }),
                clear: vi.fn(async () => { data.delete(key); }),
            };
        },
    };
}

function armedVault() {
    const consent = {
        schemaVersion: 1, id: 'bitcoin-regtest::aa', walletId: 'w1', chainId: 'bitcoin-regtest',
        sourceAddress: 'addr-payer', txid: 'aa', orderActionIndex: '500', giveCoinAmount: '0.05',
        getTick: 'PEPE', getAmount: '1000', autopay: true, payments: [], createdAt: new Date(0).toISOString(),
    };
    return {
        autopayOrders: { list: vi.fn(async () => [consent]), get: vi.fn(async () => consent), put: vi.fn(async () => {}) },
        autopayLeases: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        pendingTxs: { list: vi.fn(async () => []) },
        addresses: { list: vi.fn(async () => [{ id: 'a1', chain: 'bitcoin', network: 'regtest', address: 'addr-payer', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0" }]) },
        settings: { get: vi.fn(async () => ({ notifications: { incomingReceipts: true } })) },
        close: vi.fn(),
    };
}

const chainRegistry = { get: () => ({ coin: 'bitcoin' }), chainIdFor: (c, n) => `${c}-${n}` };
const sdkRegistry = {
    get: () => ({
        getStatus: async () => ({ last_block: { RBTC: 101 } }),
        getCoinpayObligations: async () => ({ data: [] }),
        getTransaction: async () => null,
        onCoinpayRequired: () => () => {},
    }),
};

function baseDeps(area) {
    return {
        storageBackend: area.backend('vault'),
        sessionBackend: area.backend('session-key'),
        signingSecretBackend: area.backend('xchain-wallet:session-signing-secret'),
        metaBackend: { load: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() },
    };
}

describe('locked auto pay through the pre-host lane', () => {
    it('the Locked screen types are pre-host and never public bridge types', () => {
        for (const type of ['autopay.locked.status', 'autopay.locked.stop']) {
            expect(PRE_HOST_MESSAGE_TYPES.has(type)).toBe(true);
            expect(isPublicBridgeType(type)).toBe(false);
            // A web page (content-script relay) may not send it.
            expect(isMessageAllowedFromSender(type, { id: 'ext-id', url: 'https://example.com/', tab: { id: 1 } }, 'ext-id')).toBe(false);
        }
    });

    it('wallet.lock clears both session secrets while the locked session pays from memory', async () => {
        const area = sessionArea();
        area.data.set('session-key', new Uint8Array(32).fill(7));
        area.data.set('xchain-wallet:session-signing-secret', new Uint8Array([1, 2, 3]));
        const controller = createLockedAutopay({ shellKind: 'extension', notify: vi.fn(), intervalMs: 1e9 });
        const vault = armedVault();
        const signer = { kind: 'software', exportWifForPath: vi.fn(() => FIXTURE_KEY), exportWifForAddressId: vi.fn(() => FIXTURE_KEY) };
        const pool = { get: () => signer, lockAll: vi.fn() };
        let shellVault = vault;
        const backstop = createLockBackstop({
            lockDeps: () => baseDeps(area),
            tearDownHost: async () => {
                await controller.lock({ vault: shellVault, signerPool: pool, chainRegistry, sdkRegistry });
                pool.lockAll();
                if (!controller.holdsVault(shellVault)) shellVault.close();
                shellVault = null;
            },
            isUnlocked: () => Boolean(shellVault),
            readAutoLockState: async () => null,
            clearAutoLockState: async () => {},
            shouldAutoLock: () => false,
        });

        const result = await dispatchPreHost('wallet.lock', null, {
            ...baseDeps(area),
            onLocked: (r) => backstop.onLocked(r),
            lockedAutopay: controller,
        });
        expect(result).toEqual({ locked: true });
        // The reply waited for the hand-over: the session is already running.
        expect(controller.isActive()).toBe(true);
        expect(pool.lockAll).toHaveBeenCalled();
        expect(vault.close).not.toHaveBeenCalled();
        expect(area.data.has('session-key')).toBe(false);
        expect(area.data.has('xchain-wallet:session-signing-secret')).toBe(false);
        for (const value of area.data.values()) {
            expect(String(value)).not.toContain(FIXTURE_KEY);
        }

        const status = await dispatchPreHost('autopay.locked.status', null, { ...baseDeps(area), lockedAutopay: controller });
        expect(status).toMatchObject({ active: true, orders: 1 });
        const stopped = await dispatchPreHost('autopay.locked.stop', null, { ...baseDeps(area), lockedAutopay: controller });
        expect(stopped).toEqual({ active: false });
        expect(vault.close).toHaveBeenCalledTimes(1);
    });

    it.each(['wallet.unlock', 'wallet.create', 'wallet.import', 'wallet.importBackup.fresh'])(
        '%s ends locked auto pay before its handler runs',
        async (type) => {
            const area = sessionArea();
            const order = [];
            const deps = {
                ...baseDeps(area),
                beforeSessionStart: vi.fn(async (t) => { order.push(`end:${t}`); }),
            };
            deps.metaBackend.load = vi.fn(async () => { order.push('handler'); return null; });
            await dispatchPreHost(type, { password: 'x' }, deps).catch(() => {});
            expect(deps.beforeSessionStart).toHaveBeenCalledWith(type);
            expect(order[0]).toBe(`end:${type}`);
        },
    );

    it('status without a controller reads inactive', async () => {
        const area = sessionArea();
        await expect(dispatchPreHost('autopay.locked.status', null, baseDeps(area))).resolves.toEqual({ active: false });
    });
});
