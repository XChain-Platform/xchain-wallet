/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B on desktop main: a lock with an armed auto pay order hands the
// open vault and a sealed key to the locked session, clears the keychain key
// exactly as before, and refuses every manual route; the Locked screen reads
// plain status and stops it without a password; an OS screen lock or suspend
// does not end a running session; a wipe and an unlock do. The fixture key
// string is not a key and is never printed.

import { describe, expect, it, vi } from 'vitest';
import {
    captureLockedAutopay,
    createRuntime,
    enforceSystemAutoLock,
    handleIpcMessage,
    wipeRuntimeStores,
} from '../../../packages/desktop/main/runtime.js';

const FIXTURE_KEY = 'fixture-sealed-value-not-a-key';

function backend(initial = null) {
    let value = initial;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
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
        addresses: {
            list: vi.fn(async () => [{
                id: 'a1', chain: 'bitcoin', network: 'regtest', address: 'addr-payer',
                publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0",
            }]),
        },
        settings: { get: vi.fn(async () => ({ notifications: { incomingReceipts: true } })) },
        close: vi.fn(),
    };
}

function makeRuntime() {
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: 101 } })),
        getCoinpayObligations: vi.fn(async () => ({ data: [] })),
        getTransaction: vi.fn(async () => null),
        onCoinpayRequired: vi.fn(() => () => {}),
    };
    const runtime = createRuntime({
        storageBackend: backend(new Uint8Array([1])),
        sessionBackend: backend(new Uint8Array(32).fill(7)),
        metaBackend: backend({ kdfParams: {} }),
        chainRegistry: { get: () => ({ coin: 'bitcoin' }), chainIdFor: (c, n) => `${c}-${n}` },
        sdkRegistry: { get: () => sdk },
        notify: vi.fn(async () => true),
    });
    const signer = {
        kind: 'software',
        exportWifForPath: vi.fn(() => FIXTURE_KEY),
        exportWifForAddressId: vi.fn(() => FIXTURE_KEY),
        lock: vi.fn(),
    };
    const vault = armedVault();
    runtime.vault = vault;
    runtime.signerPool = { get: vi.fn(() => signer), lockAll: vi.fn() };
    runtime.host = {
        host: { reservationLedger: { reserve: vi.fn(async () => {}), release: vi.fn(async () => {}) } },
        handle: vi.fn(async () => ({ ok: true, result: 'signed' })),
    };
    return { runtime, vault, signer };
}

describe('desktop locked auto pay', () => {
    it('wallet.lock keeps armed auto pay paying, clears the keychain key and refuses manual routes', async () => {
        const { runtime, vault } = makeRuntime();
        const locked = await handleIpcMessage(runtime, { type: 'wallet.lock' });
        expect(locked).toEqual({ ok: true, result: { locked: true } });

        expect(runtime.lockedAutopay.isActive()).toBe(true);
        expect(vault.close).not.toHaveBeenCalled();
        expect(runtime.vault).toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.sessionBackend.clear).toHaveBeenCalled();
        expect(await runtime.sessionBackend.load()).toBeNull();

        for (const type of ['action.send', 'action.coinpay', 'auth.signMessage', 'wallet.exportPrivateKey']) {
            const refused = await handleIpcMessage(runtime, { type, request: {} });
            expect(refused.ok, type).toBe(false);
            expect(refused.error.name, type).toBe('WalletLockedError');
        }

        const status = await handleIpcMessage(runtime, { type: 'autopay.locked.status' });
        expect(status.result).toMatchObject({ active: true, orders: 1, caps: [{ ticker: 'BTC', amount: '0.05' }] });
        expect(JSON.stringify(status)).not.toContain(FIXTURE_KEY);

        const stopped = await handleIpcMessage(runtime, { type: 'autopay.locked.stop' });
        expect(stopped.result).toEqual({ active: false });
        expect(vault.close).toHaveBeenCalledTimes(1);
    });

    it('an OS screen lock or suspend neither rebuilds nor ends a running session', async () => {
        const { runtime, vault } = makeRuntime();
        await handleIpcMessage(runtime, { type: 'wallet.lock' });
        expect(runtime.lockedAutopay.isActive()).toBe(true);
        runtime.autoLockStore = { load: vi.fn(async () => ({ armed: true, idleMs: 1000, lastActivityAt: 0 })), clear: vi.fn(async () => {}) };
        await enforceSystemAutoLock(runtime);
        expect(runtime.lockedAutopay.isActive()).toBe(true);
        expect(vault.close).not.toHaveBeenCalled();
        expect(await captureLockedAutopay(runtime)).toBe(false);
        await runtime.lockedAutopay.end('quit');
    });

    it('a wallet wipe ends it before the stores go', async () => {
        const { runtime, vault } = makeRuntime();
        await handleIpcMessage(runtime, { type: 'wallet.lock' });
        await wipeRuntimeStores(runtime);
        expect(runtime.lockedAutopay.isActive()).toBe(false);
        expect(vault.close).toHaveBeenCalledTimes(1);
    });

    it('an unlock attempt ends it before any vault opens', async () => {
        const { runtime, vault } = makeRuntime();
        await handleIpcMessage(runtime, { type: 'wallet.lock' });
        const order = [];
        vault.close.mockImplementation(() => order.push('session-vault-closed'));
        runtime.metaBackend.load.mockImplementation(async () => { order.push('unlock-read-meta'); return null; });
        await handleIpcMessage(runtime, { type: 'wallet.unlock', request: { password: 'not-the-password' } });
        expect(runtime.lockedAutopay.isActive()).toBe(false);
        expect(order[0]).toBe('session-vault-closed');
    });

    it('a lock with nothing armed runs exactly as before', async () => {
        const { runtime, vault } = makeRuntime();
        vault.autopayOrders.list.mockResolvedValue([]);
        await handleIpcMessage(runtime, { type: 'wallet.lock' });
        expect(runtime.lockedAutopay.isActive()).toBe(false);
        expect(vault.close).toHaveBeenCalledTimes(1);
    });
});
