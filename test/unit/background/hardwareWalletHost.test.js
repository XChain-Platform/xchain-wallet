// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The hardware wallet host messages every shell answers:
//   wallet.hardware.add       host route, adds a device wallet to the open vault
//   wallet.create.hardware    pre-host, a fresh install whose first wallet is a device
//   wallet.hardware.balances  pre-host, the connect flow's balances, vault or not
// and the HW_NOT_CONNECTED code a device route throws with no live transport.
//
// The core flow is stubbed here: these tests pin what the hosts do around it
// (which fields reach it, what is saved, what is answered), not the flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hw = { add: vi.fn() };
vi.mock('@xchain-wallet/core/flows/hardwareWallet.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, addHardwareWallet: (...args) => hw.add(...args) };
});

// A fast KDF: the lanes' persistence is under test, not Argon2id.
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            makeFreshKdfParams: () => ({ algorithm: 'argon2id', salt: 'x', memory: 1, iterations: 1, parallelism: 1 }),
            deriveMasterKey: () => new Uint8Array(32).fill(7),
        },
    };
});

const core = await import('@xchain-wallet/core');
const { dispatchPreHost, PRE_HOST_MESSAGE_TYPES } = await import(
    '../../../packages/extension/src/background/sessionMeta.js'
);
const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);
const signerBridge = await import('../../../packages/extension/src/background/signerBridge.js');
const { HARDWARE_BALANCES_MAX_PER_CHAIN } = await import(
    '../../../packages/extension/src/background/walletCreate.js'
);

const chainRegistry = core.registry.defaultRegistry();

const DEVICE = { vendor: 'trezor', model: 'Safe 3', deviceIdentifier: 'dev-1', firmwareVersion: '2.8.1' };
const ACCOUNTS = [{
    chainId: 'bitcoin-mainnet',
    accountIndex: 0,
    address: 'bc1qhwexample0',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    addressType: 'p2wpkh',
}];

function hardwareRecord(id = 'hw1') {
    return {
        id,
        name: 'My Trezor',
        format: 'hardware',
        origin: 'connected-hardware',
        encryptedSeed: '',
        importedKeys: [],
        passphraseEnabled: false,
        walletMode: 'full',
        kdfParams: { salt: 'secret-ish' },
        createdAt: '2026-11-15T00:00:00.000Z',
        schemaVersion: 1,
    };
}

function flowResult(id = 'hw1') {
    return {
        wallet: hardwareRecord(id),
        signer: { id: 'sig1', walletId: id, kind: 'trezor', vendor: 'trezor', deviceIdentifier: 'dev-1' },
        accounts: [{ id: 'acct1', walletId: id, index: 0 }],
        addresses: [{ id: 'addr1', accountId: 'acct1', address: 'bc1qhwexample0', source: 'trezor', signerId: 'sig1' }],
    };
}

function makeHost(overrides = {}) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [], get: async () => null },
        },
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
        ...overrides,
    });
}

function memoryBackend() {
    let value = null;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
        peek: () => value,
    };
}

function preHostDeps(over = {}) {
    return {
        storageBackend: memoryBackend(),
        sessionBackend: memoryBackend(),
        signingSecretBackend: memoryBackend(),
        metaBackend: memoryBackend(),
        chainRegistry,
        sdkRegistry: { get: () => null },
        onUnlocked: vi.fn(async () => {}),
        beforeSessionStart: vi.fn(async () => {}),
        ...over,
    };
}

beforeEach(() => {
    hw.add.mockReset();
    signerBridge.clearAll();
});

describe('wallet.hardware.add (host route, open vault)', () => {
    it('hands the flow only the device input plus the host vault and answers the safe shape', async () => {
        const vault = { settings: { get: async () => ({}) }, wallets: { list: async () => [], get: async () => null } };
        const publish = vi.fn(async () => {});
        const host = makeHost({ vault, surfaceStateEvents: { publish } });
        hw.add.mockResolvedValue(flowResult());

        const res = await host.handle({
            type: 'wallet.hardware.add',
            request: { name: 'My Trezor', device: DEVICE, accounts: ACCOUNTS, vault: 'not-this', password: 'never-used' },
        });

        expect(res.ok).toBe(true);
        expect(hw.add).toHaveBeenCalledTimes(1);
        const input = hw.add.mock.calls[0][0];
        expect(input.vault).toBe(vault);
        expect(input.chainRegistry).toBe(chainRegistry);
        expect(input).toMatchObject({ name: 'My Trezor', device: DEVICE, accounts: ACCOUNTS });
        expect(input).not.toHaveProperty('password');

        expect(res.result).toMatchObject({
            walletId: 'hw1',
            walletName: 'My Trezor',
            signer: { id: 'sig1', kind: 'trezor' },
            accounts: [{ id: 'acct1' }],
            addresses: [{ id: 'addr1' }],
            wallet: { id: 'hw1', format: 'hardware', origin: 'connected-hardware', walletMode: 'full' },
        });
        expect(res.result.wallet).not.toHaveProperty('encryptedSeed');
        expect(res.result.wallet).not.toHaveProperty('kdfParams');
        expect(publish).toHaveBeenCalledWith('wallets', { change: 'added', walletId: 'hw1' });
    });

    it('passes a flow refusal through in the error envelope', async () => {
        const host = makeHost();
        hw.add.mockRejectedValue(Object.assign(new Error('no accounts'), { code: 'HW_NO_ACCOUNTS' }));
        const res = await host.handle({ type: 'wallet.hardware.add', request: { name: 'x', device: DEVICE, accounts: [] } });
        expect(res.ok).toBe(false);
        expect(res.error).toMatchObject({ message: 'no accounts', code: 'HW_NO_ACCOUNTS' });
    });

    it('is a host route and never a pre-host one; create and balances are the reverse', () => {
        const registered = new Set(makeHost().types());
        expect(registered.has('wallet.hardware.add')).toBe(true);
        expect(PRE_HOST_MESSAGE_TYPES.has('wallet.hardware.add')).toBe(false);
        for (const type of ['wallet.create.hardware', 'wallet.hardware.balances']) {
            expect(PRE_HOST_MESSAGE_TYPES.has(type)).toBe(true);
            expect(registered.has(type)).toBe(false);
        }
    });
});

describe('wallet.create.hardware (pre-host, fresh install)', () => {
    it('seals a fresh vault with the device wallet, opens the session and seeds its network', async () => {
        // The record schema is the core slice's; this lane's part is the vault
        // it hands the flow, which must be open and empty.
        hw.add.mockImplementation(async (input) => {
            expect(await input.vault.wallets.list()).toEqual([]);
            return flowResult('hw1');
        });
        const deps = preHostDeps();

        const result = await dispatchPreHost('wallet.create.hardware', {
            password: 'pw-123456',
            name: 'My Trezor',
            device: DEVICE,
            accounts: ACCOUNTS,
        }, deps);

        expect(result).toEqual({
            walletId: 'hw1',
            walletName: 'My Trezor',
            signer: expect.objectContaining({ id: 'sig1' }),
            accounts: [expect.objectContaining({ id: 'acct1' })],
            addresses: [expect.objectContaining({ id: 'addr1' })],
        });
        const input = hw.add.mock.calls[0][0];
        expect(input).toMatchObject({ name: 'My Trezor', device: DEVICE, accounts: ACCOUNTS, chainRegistry });
        expect(input).not.toHaveProperty('password');

        expect(deps.beforeSessionStart).toHaveBeenCalledWith('wallet.create.hardware');
        expect(deps.storageBackend.peek()).not.toBeNull();
        expect(deps.metaBackend.save).toHaveBeenCalledWith({ kdfParams: expect.any(Object) });
        expect(deps.sessionBackend.save).toHaveBeenCalledTimes(1);
        expect(deps.signingSecretBackend.save).toHaveBeenCalledTimes(1);
        expect(deps.onUnlocked).toHaveBeenCalledTimes(1);

        // The saved blob opens under the same key and holds settings that land
        // on the accounts' own network.
        const reopened = new core.storage.Vault({ backend: deps.storageBackend, masterKey: new Uint8Array(32).fill(7) });
        await reopened.open();
        const settings = await reopened.settings.get();
        expect(settings).not.toBeNull();
        expect(settings.activeNetwork).toBe('mainnet');
        reopened.close();
    });

    it('refuses without a password and writes nothing', async () => {
        const deps = preHostDeps();
        await expect(dispatchPreHost('wallet.create.hardware', { device: DEVICE, accounts: ACCOUNTS }, deps))
            .rejects.toThrow('wallet.create.hardware: password is required');
        expect(hw.add).not.toHaveBeenCalled();
        expect(deps.storageBackend.save).not.toHaveBeenCalled();
        expect(deps.metaBackend.save).not.toHaveBeenCalled();
    });

    it('refuses onto an install that already holds a wallet', async () => {
        const deps = preHostDeps();
        await deps.metaBackend.save({ kdfParams: {} });
        await expect(dispatchPreHost('wallet.create.hardware', { password: 'pw', device: DEVICE, accounts: ACCOUNTS }, deps))
            .rejects.toMatchObject({ name: 'WalletExistsError' });
        expect(hw.add).not.toHaveBeenCalled();
    });

    it('leaves the install fresh when the flow refuses', async () => {
        hw.add.mockRejectedValue(new Error('device account invalid'));
        const deps = preHostDeps();
        await expect(dispatchPreHost('wallet.create.hardware', { password: 'pw', device: DEVICE, accounts: ACCOUNTS }, deps))
            .rejects.toThrow('device account invalid');
        expect(deps.storageBackend.peek()).toBeNull();
        expect(deps.metaBackend.peek()).toBeNull();
        expect(deps.sessionBackend.save).not.toHaveBeenCalled();
        expect(deps.onUnlocked).not.toHaveBeenCalled();
    });
});

/** An explorer stand-in that counts its reads and answers every address with `coins`. */
function countingSdkRegistry(coins = '0.5') {
    const calls = [];
    const sdk = {
        getBalancesBatch: vi.fn(async (addresses) => {
            calls.push(addresses.length);
            return Object.fromEntries(addresses.map((address) => [address, {
                balances: { data: [] },
                address: { address, balances: { confirmed: coins } },
            }]));
        }),
    };
    return { registry: { get: vi.fn(() => sdk) }, sdk, calls };
}

function countingPriceOracle(prices = { 'bitcoin-mainnet': { priceFiat: 50000 }, 'litecoin-mainnet': { priceFiat: 80 } }) {
    return { getNativePrices: vi.fn(async () => ({ prices })) };
}

function itemsFor(perChain) {
    const items = [];
    for (const chainId of ['bitcoin-mainnet', 'litecoin-mainnet']) {
        for (let i = 0; i < perChain; i += 1) items.push({ chainId, address: `${chainId}-addr-${i}` });
    }
    return items;
}

describe('wallet.hardware.balances (pre-host, any session state)', () => {
    it('answers balance and fiat per row in request order', async () => {
        const { registry } = countingSdkRegistry('0.5');
        const priceOracle = countingPriceOracle();
        const rows = await dispatchPreHost('wallet.hardware.balances', { items: itemsFor(1) }, preHostDeps({
            sdkRegistry: registry,
            priceOracle,
        }));
        expect(rows).toEqual([
            {
                chainId: 'bitcoin-mainnet',
                address: 'bitcoin-mainnet-addr-0',
                balance: '0.5',
                quantity: '50000000',
                divisibility: 8,
                fiat: 25000,
                currency: 'USD',
                error: null,
            },
            {
                chainId: 'litecoin-mainnet',
                address: 'litecoin-mainnet-addr-0',
                balance: '0.5',
                quantity: '50000000',
                divisibility: 8,
                fiat: 40,
                currency: 'USD',
                error: null,
            },
        ]);
    });

    it('reads once per network and once for prices, whatever the row count', async () => {
        const counts = [];
        for (const perChain of [1, HARDWARE_BALANCES_MAX_PER_CHAIN]) {
            const { registry, calls } = countingSdkRegistry();
            const priceOracle = countingPriceOracle();
            const readSettings = vi.fn(async () => ({ fiatCurrency: 'USD', privacy: { priceDataEnabled: true } }));
            const rows = await dispatchPreHost('wallet.hardware.balances', { items: itemsFor(perChain) }, preHostDeps({
                sdkRegistry: registry,
                priceOracle,
                readSettings,
            }));
            expect(rows).toHaveLength(perChain * 2);
            counts.push({
                balanceReads: calls.length,
                priceReads: priceOracle.getNativePrices.mock.calls.length,
                settingsReads: readSettings.mock.calls.length,
            });
        }
        expect(counts[0]).toEqual({ balanceReads: 2, priceReads: 1, settingsReads: 1 });
        expect(counts[1]).toEqual(counts[0]);
    });

    it('refuses more addresses on one network than one batch read holds', async () => {
        const { registry, sdk } = countingSdkRegistry();
        const items = Array.from({ length: HARDWARE_BALANCES_MAX_PER_CHAIN + 1 }, (_, i) => ({
            chainId: 'bitcoin-mainnet',
            address: `a${i}`,
        }));
        await expect(dispatchPreHost('wallet.hardware.balances', { items }, preHostDeps({ sdkRegistry: registry, priceOracle: null })))
            .rejects.toMatchObject({ code: 'HW_BALANCES_TOO_MANY' });
        expect(sdk.getBalancesBatch).not.toHaveBeenCalled();
    });

    it('skips the price read when the open vault turned price data off', async () => {
        const { registry } = countingSdkRegistry('1');
        const priceOracle = countingPriceOracle();
        const rows = await dispatchPreHost('wallet.hardware.balances', { items: itemsFor(1) }, preHostDeps({
            sdkRegistry: registry,
            priceOracle,
            readSettings: async () => ({ fiatCurrency: 'EUR', privacy: { priceDataEnabled: false } }),
        }));
        expect(priceOracle.getNativePrices).not.toHaveBeenCalled();
        expect(rows.every((r) => r.fiat === null && r.currency === 'EUR' && r.balance === '1')).toBe(true);
    });

    it('marks a network unavailable without failing the others or reading per address', async () => {
        const good = countingSdkRegistry('0.25');
        const failing = { getBalancesBatch: vi.fn(async () => { throw new Error('explorer down'); }) };
        const registry = { get: (chainId) => (chainId === 'litecoin-mainnet' ? failing : good.sdk) };
        const rows = await dispatchPreHost('wallet.hardware.balances', { items: itemsFor(3) }, preHostDeps({
            sdkRegistry: registry,
            priceOracle: countingPriceOracle(),
        }));
        expect(failing.getBalancesBatch).toHaveBeenCalledTimes(1);
        const ltc = rows.filter((r) => r.chainId === 'litecoin-mainnet');
        expect(ltc.every((r) => r.balance === null && r.fiat === null && r.error === 'explorer down')).toBe(true);
        const btc = rows.filter((r) => r.chainId === 'bitcoin-mainnet');
        expect(btc.every((r) => r.balance === '0.25' && r.fiat === 12500 && r.error === null)).toBe(true);
    });

    it('rejects a malformed request', async () => {
        await expect(dispatchPreHost('wallet.hardware.balances', {}, preHostDeps({ priceOracle: null })))
            .rejects.toThrow('items must be an array');
        await expect(dispatchPreHost('wallet.hardware.balances', { items: [{ chainId: 'bitcoin-mainnet' }] }, preHostDeps({ priceOracle: null })))
            .rejects.toThrow('every item needs a chainId and an address');
    });

    it('never starts a session (locked auto pay keeps running)', async () => {
        const deps = preHostDeps({ sdkRegistry: countingSdkRegistry().registry, priceOracle: null });
        await dispatchPreHost('wallet.hardware.balances', { items: itemsFor(1) }, deps);
        expect(deps.beforeSessionStart).not.toHaveBeenCalled();
    });
});

describe('HW_NOT_CONNECTED on a device route with no live transport', () => {
    const SIGNER = { id: 'sig1', walletId: 'w1', kind: 'trezor', vendor: 'trezor' };

    it('requireTransport throws the typed error and returns a registered transport', () => {
        expect(() => signerBridge.requireTransport('sig1')).toThrow(signerBridge.HardwareNotConnectedError);
        try {
            signerBridge.requireTransport('sig1');
        } catch (err) {
            expect(err.code).toBe(signerBridge.HW_NOT_CONNECTED);
            expect(err.code).toBe('HW_NOT_CONNECTED');
        }
        const transport = async () => ({});
        signerBridge.setTransport('sig1', transport);
        expect(signerBridge.requireTransport('sig1')).toBe(transport);
    });

    it('a send from a device address answers code HW_NOT_CONNECTED', async () => {
        const vault = {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [], get: async () => null },
            addresses: {
                get: async () => ({ id: 'addr1', accountId: 'acct1', address: 'bc1qx', source: 'trezor', signerId: 'sig1' }),
                list: async () => [],
            },
            accounts: { get: async () => ({ id: 'acct1', walletId: 'w1' }) },
            signers: { find: async () => SIGNER },
        };
        const res = await makeHost({ vault }).handle({
            type: 'action.send.hw',
            request: { walletId: 'w1', from: { addressId: 'addr1' } },
        });
        expect(res.ok).toBe(false);
        expect(res.error).toMatchObject({ name: 'HardwareNotConnectedError', code: 'HW_NOT_CONNECTED' });
    });

    it('a signerId route (chain activation) answers code HW_NOT_CONNECTED', async () => {
        const vault = {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [], get: async () => null },
            signers: { find: async () => SIGNER },
        };
        const res = await makeHost({ vault }).handle({
            type: 'wallet.activateChain',
            request: { walletId: 'w1', signerId: 'sig1', chainId: 'bitcoin-mainnet' },
        });
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('HW_NOT_CONNECTED');
    });
});

describe('seed-only host paths skip a hardware wallet', () => {
    function vaultWith(wallet) {
        return {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [wallet], get: vi.fn(async (id) => (id === wallet.id ? wallet : null)) },
            accounts: { get: async () => ({ id: 'acct1', walletId: wallet.id }) },
            addresses: {
                get: async () => ({ id: 'addr1', accountId: 'acct1', address: 'bc1qx', label: null }),
                put: vi.fn(async () => {}),
            },
        };
    }

    it('signerReady answers ready false and hardware true without asking the pool', async () => {
        const signerPool = { has: vi.fn(() => true) };
        const res = await makeHost({ vault: vaultWith(hardwareRecord('hw1')), signerPool }).handle({
            type: 'wallet.signerReady',
            request: { walletId: 'hw1' },
        });
        expect(res).toEqual({ ok: true, result: { ready: false, hardware: true } });
        expect(signerPool.has).not.toHaveBeenCalled();
    });

    it('signerReady still answers from the pool for a seed wallet', async () => {
        const signerPool = { has: vi.fn(() => true) };
        const res = await makeHost({ vault: vaultWith({ id: 'w1', format: 'bip39' }), signerPool }).handle({
            type: 'wallet.signerReady',
            request: { walletId: 'w1' },
        });
        expect(res).toEqual({ ok: true, result: { ready: true } });
    });

    it('label-sync routes refuse a hardware wallet with the typed no-seed error', async () => {
        const host = makeHost({ vault: vaultWith(hardwareRecord('hw1')) });
        for (const type of ['wallet.prepareLabels', 'wallet.publishLabels', 'wallet.restoreLabels']) {
            const res = await host.handle({ type, request: { walletId: 'hw1', chainId: 'bitcoin-mainnet' } });
            expect(res.ok, type).toBe(false);
            expect(res.error, type).toMatchObject({ name: 'HardwareWalletHasNoSeedError', code: 'HW_NO_SEED' });
        }
    });

    it('a label edit on a hardware wallet raises no publish prompt', async () => {
        const vault = vaultWith(hardwareRecord('hw1'));
        const host = makeHost({ vault });
        const res = await host.handle({ type: 'addresses.setLabel', request: { id: 'addr1', label: 'Savings' } });
        expect(res.ok).toBe(true);
        expect(vault.addresses.put).toHaveBeenCalledTimes(1);
        const status = await host.handle({ type: 'wallet.labelSyncStatus' });
        expect(status.result).toMatchObject({ pending: false, changeCount: 0 });
    });

    it('a label edit on a seed wallet still counts toward the publish prompt', async () => {
        const host = makeHost({ vault: vaultWith({ id: 'w1', format: 'bip39' }) });
        await host.handle({ type: 'addresses.setLabel', request: { id: 'addr1', label: 'Savings' } });
        const status = await host.handle({ type: 'wallet.labelSyncStatus' });
        expect(status.result).toMatchObject({ changeCount: 1 });
    });
});
