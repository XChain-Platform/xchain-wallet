// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Exercise the five highest-risk modules missing from the unit and smoke import graph:
// the extension entry, both public test-dApp modules, and both fail-shut SDK shims.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockXChainProvider } from '../../../packages/test-dapp/src/mock-provider.ts';
import { runExample } from '../../../packages/test-dapp/src/example.ts';
import httpShim, { Agent } from '../../../packages/core/src/shims/http-browser.js';
import replShim, { start as startRepl } from '../../../packages/core/src/shims/repl-browser.js';

const bg = vi.hoisted(() => ({
    alarmListener: vi.fn(),
    applyLayoutMode: vi.fn(async () => {}),
    attachChromeRuntime: vi.fn(() => vi.fn()),
    attachLayoutModeListener: vi.fn(),
    attachSessionMetaListener: vi.fn(),
    attachSignerBridgeListener: vi.fn(),
    attachWipeStorageListener: vi.fn(),
    connectedTabsAttach: vi.fn(),
    ensureBuilds: vi.fn(),
    keepalive: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    readLayoutMode: vi.fn(async () => 'popup'),
    sessionLoad: vi.fn(async () => null),
}));

vi.mock('@xchain-wallet/core', () => ({
    registry: {
        defaultRegistry: vi.fn(() => ({ chains: [] })),
        syncChainRegistryFromHub: vi.fn(async () => ({ ok: true })),
    },
    sdk: {
        SDKRegistry: class SDKRegistry {
            get() { return null; }
        },
    },
    signers: {
        SignerPool: class SignerPool {
            size() { return 0; }
            lockAll() {}
        },
    },
    storage: {
        Vault: class Vault {},
    },
    flows: {},
    notifications: {},
}));

vi.mock('../../../packages/extension/src/storage/index.js', () => ({
    ChromeSessionBackend: class ChromeSessionBackend {
        load() { return bg.sessionLoad(); }
    },
    ChromeStorageBackend: class ChromeStorageBackend {},
}));

vi.mock('../../../packages/extension/src/background/index.js', () => ({
    ApprovalBroker: class ApprovalBroker {
        async cancelAll() {}
    },
    attachChromeRuntime: bg.attachChromeRuntime,
    attachSessionMetaListener: bg.attachSessionMetaListener,
    attachSignerBridgeListener: bg.attachSignerBridgeListener,
    attachWipeStorageListener: bg.attachWipeStorageListener,
    createBackgroundHost: vi.fn(),
    createConnectedTabRegistry: vi.fn(() => ({
        attach: bg.connectedTabsAttach,
        record: vi.fn(),
    })),
    createDevMockSdk: vi.fn(),
    resolveSdkFactory: vi.fn(async () => ({ factory: vi.fn(), source: 'xchain-sdk' })),
}));

vi.mock('../../../packages/extension/src/background/sdkStatic.js', () => ({
    XChainSDK: class XChainSDK {},
}));
vi.mock('../../../packages/extension/src/background/signingSecretSession.js', () => ({
    SIGNING_SECRET_SESSION_KEY: 'signing-secret',
    loadSigningCredentials: vi.fn(async () => null),
}));
vi.mock('../../../packages/extension/src/background/panicModeStorage.js', () => ({
    initPanicModePersistence: vi.fn(async () => {}),
}));
vi.mock('../../../packages/extension/src/background/broadcastQueueStorage.js', () => ({
    createBroadcastQueueStorage: vi.fn(() => ({})),
}));
vi.mock('../../../packages/extension/src/background/broadcastQueueStore.js', () => ({
    createBroadcastQueueStore: vi.fn(() => ({})),
    sealBroadcastQueueStore: vi.fn(async () => {}),
}));
vi.mock('../../../packages/extension/src/background/autoLockState.js', () => ({
    readAutoLockState: vi.fn(),
    stampAutoLockActivity: vi.fn(async () => {}),
    clearAutoLockState: vi.fn(async () => {}),
    shouldAutoLock: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/walletLock.js', () => ({
    createHostBuildFlight: vi.fn((build) => async (...args) => {
        bg.ensureBuilds();
        return build(...args);
    }),
    createKeepaliveTick: vi.fn(() => bg.keepalive),
    createLockBackstop: vi.fn(() => ({
        lockWalletNow: vi.fn(async () => {}),
        maybeAutoLock: vi.fn(async () => 'skipped'),
        noteUnlocked: vi.fn(),
        onLocked: vi.fn(),
    })),
}));
vi.mock('../../../packages/extension/src/bridge/bridgeEvents.js', () => ({
    createBridgeEventBroadcaster: vi.fn(() => ({})),
}));
vi.mock('../../../packages/extension/src/background/layoutMode.js', () => ({
    applyLayoutMode: bg.applyLayoutMode,
    attachLayoutModeListener: bg.attachLayoutModeListener,
    readLayoutMode: bg.readLayoutMode,
}));
vi.mock('../../../packages/extension/src/background/extensionCommands.js', () => ({
    attachExtensionCommandListener: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/walletCreate.js', () => ({
    restoreLabelSyncBestEffort: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/labelSyncRestoreTasks.js', () => ({
    startLabelSyncRestoreTask: vi.fn(),
}));
vi.mock('../../../packages/extension/src/shared/surfaceStateSync.js', () => ({
    createSurfaceStateBroadcaster: vi.fn(() => ({ publish: bg.publish })),
}));
vi.mock('../../../packages/extension/src/background/chromeNotifications.js', () => ({
    createChromeNotifier: vi.fn(() => vi.fn()),
}));

const chromeStub = {
    action: { openPopup: vi.fn() },
    alarms: {
        create: vi.fn(),
        onAlarm: { addListener: bg.alarmListener },
    },
    commands: {},
    runtime: {},
    storage: { local: { get: vi.fn(), set: vi.fn() } },
    tabs: {},
    windows: { getLastFocused: vi.fn() },
};

beforeAll(() => {
    vi.stubGlobal('chrome', chromeStub);
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('extension service-worker entry', () => {
    it('registers every always-on boundary and starts one host build', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { sdkResolved } = await import('../../../packages/extension/src/background.js');

        await expect(sdkResolved).resolves.toBe('xchain-sdk');
        await vi.waitFor(() => expect(bg.applyLayoutMode).toHaveBeenCalledWith('popup'));
        expect(bg.attachLayoutModeListener).toHaveBeenCalledOnce();
        expect(bg.attachSessionMetaListener).toHaveBeenCalledOnce();
        expect(bg.attachSignerBridgeListener).toHaveBeenCalledOnce();
        expect(bg.attachWipeStorageListener).toHaveBeenCalledOnce();
        expect(bg.connectedTabsAttach).toHaveBeenCalledWith(chromeStub.tabs);
        expect(chromeStub.alarms.create).toHaveBeenCalledWith(
            'xchain-ws-keepalive',
            { periodInMinutes: 0.4 },
        );
        expect(bg.ensureBuilds).toHaveBeenCalledOnce();
        expect(bg.sessionLoad).toHaveBeenCalledOnce();

        const onAlarm = bg.alarmListener.mock.calls[0][0];
        onAlarm({ name: 'another-alarm' });
        expect(bg.keepalive).not.toHaveBeenCalled();
        onAlarm({ name: 'xchain-ws-keepalive' });
        expect(bg.keepalive).toHaveBeenCalledOnce();
        log.mockRestore();
    });
});

describe('test-dApp runtime modules', () => {
    it('models permissions, signing, unsupported actions, and disconnect', async () => {
        const provider = new MockXChainProvider();
        const accountsChanged = vi.fn();
        provider.on('accountsChanged', accountsChanged);

        const connected = await provider.connect({ appName: 'Unit dApp' });
        expect(connected).toMatchObject({
            ok: true,
            chains: ['bitcoin'],
            permissions: { canSignMessage: true },
        });
        expect(accountsChanged).toHaveBeenCalledOnce();
        const [address] = await provider.getAddresses('bitcoin-regtest');

        await expect(provider.signMessage({
            chainId: 'bitcoin-regtest',
            address: address.address,
            message: 'hello',
        })).resolves.toMatchObject({ ok: true, signedMessage: 'hello' });
        await expect(provider.signAction({
            chainId: 'bitcoin-regtest',
            action: 'ISSUE',
            params: {},
        })).resolves.toMatchObject({
            ok: false,
            error: 'UNSUPPORTED_ACTION',
            supportedActions: ['SEND', 'SWEEP'],
        });

        await provider.disconnect();
        await expect(provider.getAccounts()).rejects.toThrow('not connected');
    });

    it('runs the public example end to end through the package runtime entry', async () => {
        const provider = new MockXChainProvider();
        const uninstall = provider.install();
        try {
            await expect(runExample()).resolves.toMatchObject({
                providerFound: true,
                connected: true,
                accountCount: 1,
                signInOk: true,
                signMessageOk: true,
                issueRejectedAsUnsupported: true,
            });
            await expect(provider.getAccounts()).rejects.toThrow('not connected');
        } finally {
            uninstall();
        }
    });

    it('disconnects when a connected provider has no active chain', async () => {
        const disconnect = vi.fn(async () => {});
        const provider = {
            isXChainWallet: true,
            connect: vi.fn(async () => ({
                ok: true,
                version: '0.1.0',
                accounts: [],
                chains: [],
                permissions: {
                    chains: [],
                    accounts: [],
                    canSignMessage: false,
                    canSignAction: {},
                },
            })),
            getActiveChains: vi.fn(async () => []),
            disconnect,
        };
        globalThis.xchain = provider;
        try {
            await expect(runExample()).resolves.toMatchObject({
                providerFound: true,
                connected: true,
                accountCount: 0,
            });
            expect(disconnect).toHaveBeenCalledOnce();
        } finally {
            delete globalThis.xchain;
        }
    });
});

describe('browser SDK shims', () => {
    it('provides an inert HTTP agent with a safe destroy path', () => {
        expect(httpShim.Agent).toBe(Agent);
        const agent = new Agent({ keepAlive: true });
        expect(() => agent.destroy()).not.toThrow();
    });

    it('refuses Node REPL startup through named and default exports', () => {
        expect(replShim.start).toBe(startRepl);
        expect(() => startRepl()).toThrow('not available in browser contexts');
    });
});
