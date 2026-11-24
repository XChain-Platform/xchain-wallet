// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    activityStarts: [],
    autopayOptions: [],
    bridge: {
        onIntent: vi.fn(() => vi.fn()),
        sendDetail: vi.fn(async () => true),
    },
    deadlineOptions: [],
    deferred: [],
    intentOptions: [],
    scheduleCalls: [],
    startWatchHost: vi.fn(async () => true),
    webNotify: Object.assign(vi.fn(async () => true), {
        playSound: vi.fn(),
    }),
}));

vi.mock('../../../packages/core/src/watch/watchBridge.js', () => ({
    createWatchBridge: () => h.bridge,
}));
vi.mock('../../../packages/core/src/watch/watchHost.js', () => ({
    startWatchHost: h.startWatchHost,
}));
vi.mock('../../../packages/core/src/watch/watchIntents.js', () => ({
    createWatchIntents: (options) => {
        h.intentOptions.push(options);
        return { handle: vi.fn() };
    },
}));
vi.mock('../../../packages/core/src/notifications/activityCheckConfig.js', () => ({
    HOME_BALANCES_PUBLISHED_EVENT: 'xc:home-balances-published',
    startActivityCheckSync: (options) => {
        h.activityStarts.push(options);
        return vi.fn();
    },
}));
vi.mock('../../../packages/core/src/notifications/scheduledDeadlines.js', () => ({
    syncDeadlineSchedule: async (items, options) => {
        h.scheduleCalls.push({ items, options });
        return items;
    },
}));
vi.mock('../../../packages/web/src/notifications/webNotifyAdapter.js', () => ({
    createWebNotifyAdapter: () => h.webNotify,
}));
vi.mock('../../../packages/core/src/market/autopaySession.js', () => ({
    createLockedAutopay: (options) => {
        h.autopayOptions.push(options);
        return {
            instanceId: 'test',
            end: vi.fn(async () => false),
            holdsVault: () => false,
            isActive: () => false,
            lock: vi.fn(async () => false),
            status: () => ({ active: false }),
            takeHandoff: () => [],
        };
    },
}));

class InertWatcher {
    constructor() {}
    start() { return Promise.resolve(this); }
    stop() {}
    refresh() { return Promise.resolve(); }
}

vi.mock('../../../packages/core/src/notifications/NotificationService.js', () => ({
    NotificationService: InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/PriceAlertWatcher.js', () => ({
    PriceAlertWatcher: InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/GovernancePollWatcher.js', () => ({
    GovernancePollWatcher: InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/DispenserEscrowWatcher.js', () => ({
    DispenserEscrowWatcher: InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js', () => ({
    CoinpayAutopayWatcher: InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/DeadlineWatcher.js', () => ({
    DeadlineWatcher: class extends InertWatcher {
        constructor(options) {
            super();
            h.deadlineOptions.push(options);
        }
    },
}));
vi.mock('../../../packages/web/src/deferNonCriticalWork.js', () => ({
    deferNonCriticalWork: (callback) => {
        h.deferred.push(callback);
        return vi.fn();
    },
}));
vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => ({
    ...(await importOriginal()),
    deriveMasterKeyAsync: async () => new Uint8Array(32).fill(7),
    makeFreshKdfParams: () => ({ algorithm: 'argon2id' }),
}));
vi.mock('../../../packages/core/src/storage/Vault.js', () => ({
    Vault: class {
        async open() {}
        async save() {}
        setAutoSave() {}
        close() {}
    },
}));
vi.mock('../../../packages/core/src/signers/SignerPool.js', () => ({
    SignerPool: class {
        async populate() { return {}; }
        lockAll() {}
    },
}));
vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createMetaBackend: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    createStorageBackend: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    installNativeScreenGuard: () => {},
    installNativeWipeHook: () => {},
    usingNativeVault: () => true,
}));
vi.mock('../../../packages/extension/src/background/createBackgroundHost.js', () => ({
    createBackgroundHost: () => ({
        handle: vi.fn(async () => ({ ok: true, result: true })),
        reservationLedger: {},
    }),
}));
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            createWallet: async () => ({ mnemonic: 'words', wallet: { id: 'wallet-1', name: 'Main Wallet' } }),
            getSettings: async () => ({ notifications: {} }),
            reconcilePhraseRecoveryInMeta: async () => {},
        },
    };
});

function nativeCapacitor() {
    return {
        isNativePlatform: () => true,
        Plugins: {
            XChainNotify: {
                addListener: vi.fn(async () => ({ remove: vi.fn() })),
                cancel: vi.fn(async () => true),
                post: vi.fn(async () => true),
                schedule: vi.fn(async () => true),
            },
        },
    };
}

async function loadHost(capacitor, shellGlobals = {}) {
    vi.stubGlobal('Capacitor', capacitor);
    for (const [name, value] of Object.entries(shellGlobals)) vi.stubGlobal(name, value);
    return import('../../../packages/web/src/hostBridge.js');
}

beforeEach(() => {
    vi.resetModules();
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events));
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
    h.activityStarts.length = 0;
    h.autopayOptions.length = 0;
    h.deadlineOptions.length = 0;
    h.deferred.length = 0;
    h.intentOptions.length = 0;
    h.scheduleCalls.length = 0;
    h.startWatchHost.mockClear();
    h.bridge.onIntent.mockClear();
    h.bridge.sendDetail.mockClear();
    h.webNotify.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('web host native watch wiring', () => {
    it('starts native delivery, watch intents, and activity config only in a native shell', async () => {
        const capacitor = nativeCapacitor();
        await loadHost(capacitor);
        await vi.waitFor(() => expect(h.startWatchHost).toHaveBeenCalledWith({ bridge: h.bridge }));

        expect(h.intentOptions).toHaveLength(1);
        expect(h.bridge.onIntent).toHaveBeenCalledOnce();
        expect(h.activityStarts).toHaveLength(1);
        expect(h.autopayOptions[0].notify).not.toBe(h.webNotify);
        await h.autopayOptions[0].notify({ kind: 'payment', title: 'Paid', body: 'Done' });
        expect(capacitor.Plugins.XChainNotify.post).toHaveBeenCalledOnce();

        const homeState = { rows: [{ id: 'bitcoin-mainnet:BTC' }], walletId: 'wallet-1' };
        globalThis.dispatchEvent(new CustomEvent('xc:home-balances-published', { detail: homeState }));
        expect(h.intentOptions[0].getRows()).toBe(homeState.rows);
        expect(h.activityStarts[0].readState()).toBe(homeState);
    });

    it.each([
        ['web', {}],
        ['extension', { chrome: { runtime: { id: 'extension-test' } } }],
        ['desktop', { xchainWalletBridge: { sendMessage: vi.fn() } }],
    ])('keeps the %s path on web delivery without native watch services', async (_shell, shellGlobals) => {
        await loadHost(undefined, shellGlobals);

        expect(h.startWatchHost).not.toHaveBeenCalled();
        expect(h.intentOptions).toHaveLength(0);
        expect(h.activityStarts).toHaveLength(0);
        expect(h.autopayOptions[0].notify).toBe(h.webNotify);
    });

    it('leaves extension and desktop requests on their existing transports', async () => {
        const extensionSend = vi.fn((_message, respond) => {
            respond({ ok: true, result: 'extension-result' });
        });
        vi.stubGlobal('chrome', { runtime: { sendMessage: extensionSend } });
        const { sendMessage: sendExtension } = await import(
            '../../../packages/extension/src/shared/chromeMessaging.js'
        );

        await expect(sendExtension('session.status')).resolves.toBe('extension-result');
        expect(extensionSend).toHaveBeenCalledWith(
            { type: 'session.status', request: undefined },
            expect.any(Function),
        );

        const desktopSend = vi.fn(async () => ({ ok: true, result: 'desktop-result' }));
        vi.stubGlobal('xchainWalletBridge', { sendMessage: desktopSend });
        const { sendMessage: sendDesktop } = await import(
            '../../../packages/desktop/renderer/bridgeMessaging.js'
        );

        await expect(sendDesktop('session.status')).resolves.toBe('desktop-result');
        expect(desktopSend).toHaveBeenCalledWith({ type: 'session.status', request: undefined });
    });

    it('schedules native deadline results with stable ids and cancels resolved items', async () => {
        const capacitor = nativeCapacitor();
        const { createWalletLocal } = await loadHost(capacitor);
        await createWalletLocal({ password: 'pw' });
        h.deferred.splice(0).forEach((callback) => callback());
        expect(h.deadlineOptions).toHaveLength(1);

        await h.deadlineOptions[0].notify({
            kind: 'deadline',
            title: 'Order expires soon',
            body: 'Your order expires soon.',
            data: {
                chainId: 'bitcoin-mainnet',
                kind: 'order',
                actionIndex: '7',
                expiration: 2_000_000_000,
            },
        });

        expect(h.scheduleCalls).toHaveLength(1);
        expect(h.scheduleCalls[0].items).toEqual([
            expect.objectContaining({
                key: 'bitcoin-mainnet:order:7',
                deadlineMs: 2_000_000_000_000,
            }),
        ]);
        expect(typeof h.scheduleCalls[0].options.notify.schedule).toBe('function');

        h.deadlineOptions[0].loadSeen();
        await h.deadlineOptions[0].saveSeen({ 'bitcoin-mainnet': ['order:7'] });
        await h.deadlineOptions[0].saveSeen({});
        expect(capacitor.Plugins.XChainNotify.cancel).toHaveBeenCalledWith({
            id: 'deadline:bitcoin-mainnet:order:7',
        });
    });
});
