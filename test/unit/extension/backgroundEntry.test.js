// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
    alarmListener: null,
    commandOptions: null,
    layoutMode: 'popup',
    applyLayoutMode: vi.fn(async () => {}),
    attachLayoutModeListener: vi.fn(),
    keepaliveTick: vi.fn(async () => {}),
    openPopup: vi.fn(async () => 'popup-opened'),
    openSidePanel: vi.fn(async () => 'side-panel-opened'),
    readLayoutMode: vi.fn(async () => controls.layoutMode),
}));

vi.mock('@xchain-wallet/core', () => ({
    registry: {
        defaultRegistry: vi.fn(() => ({})),
        syncChainRegistryFromHub: vi.fn(async () => ({ ok: true })),
    },
    sdk: {
        SDKRegistry: class SDKRegistry {},
    },
    signers: {
        SignerPool: class SignerPool {
            size() { return 0; }
            lockAll() {}
        },
    },
    storage: { Vault: class Vault {} },
    flows: {},
    notifications: {},
}));
vi.mock('@xchain-wallet/core/buildInfo.js', () => ({ WALLET_VERSION: 'test-version' }));
vi.mock('../../../packages/extension/src/storage/index.js', () => ({
    ChromeSessionBackend: class ChromeSessionBackend {
        async load() { return null; }
    },
    ChromeStorageBackend: class ChromeStorageBackend {},
}));
vi.mock('../../../packages/extension/src/background/index.js', () => ({
    ApprovalBroker: class ApprovalBroker {
        async cancelAll() {}
    },
    attachChromeRuntime: vi.fn(),
    attachSessionMetaListener: vi.fn(),
    attachSignerBridgeListener: vi.fn(),
    attachWipeStorageListener: vi.fn(),
    createBackgroundHost: vi.fn(),
    createConnectedTabRegistry: vi.fn(() => ({ attach: vi.fn(), record: vi.fn() })),
    createDevMockSdk: vi.fn(),
    resolveSdkFactory: vi.fn(async () => ({ factory: vi.fn(), source: 'sdk' })),
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
    createHostBuildFlight: vi.fn(() => vi.fn(async () => null)),
    createKeepaliveTick: vi.fn(() => controls.keepaliveTick),
    createLockBackstop: vi.fn(() => ({
        lockWalletNow: vi.fn(async () => {}),
        maybeAutoLock: vi.fn(async () => 'skipped'),
        noteUnlocked: vi.fn(),
        onLocked: vi.fn(),
    })),
}));
vi.mock('../../../packages/extension/src/bridge/bridgeEvents.js', () => ({
    createBridgeEventBroadcaster: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/layoutMode.js', () => ({
    applyLayoutMode: controls.applyLayoutMode,
    attachLayoutModeListener: controls.attachLayoutModeListener,
    currentLayoutMode: () => controls.layoutMode,
    readLayoutMode: controls.readLayoutMode,
}));
vi.mock('../../../packages/extension/src/background/extensionCommands.js', () => ({
    attachExtensionCommandListener: vi.fn((options) => { controls.commandOptions = options; }),
}));
vi.mock('../../../packages/extension/src/background/walletCreate.js', () => ({
    restoreLabelSyncBestEffort: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/labelSyncRestoreTasks.js', () => ({
    startLabelSyncRestoreTask: vi.fn(),
}));
vi.mock('../../../packages/extension/src/shared/surfaceStateSync.js', () => ({
    createSurfaceStateBroadcaster: vi.fn(() => ({ publish: vi.fn(async () => {}) })),
}));
vi.mock('../../../packages/extension/src/background/chromeNotifications.js', () => ({
    createChromeNotifier: vi.fn(() => vi.fn()),
}));

let backgroundModule;

beforeAll(async () => {
    vi.stubGlobal('chrome', {
        action: { openPopup: controls.openPopup },
        alarms: {
            create: vi.fn(),
            onAlarm: {
                addListener: vi.fn((listener) => { controls.alarmListener = listener; }),
            },
        },
        commands: {},
        runtime: {},
        sidePanel: { open: controls.openSidePanel },
        windows: { WINDOW_ID_CURRENT: -2 },
    });

    backgroundModule = await import('../../../packages/extension/src/background.js');
});

describe('extension background entrypoint', () => {
    it('initializes the saved layout and publishes SDK readiness', async () => {
        await expect(backgroundModule.sdkResolved).resolves.toBe('sdk');
        await vi.waitFor(() => {
            expect(controls.applyLayoutMode).toHaveBeenCalledWith('popup');
        });
        expect(controls.attachLayoutModeListener).toHaveBeenCalledOnce();
    });

    it('opens commands in a side panel or popup according to the live setting', async () => {
        controls.layoutMode = 'sidepanel';
        const firstOpen = controls.commandOptions.openWallet({ windowId: 7 });
        expect(controls.openSidePanel).toHaveBeenCalledWith({ windowId: 7 });
        await expect(firstOpen)
            .resolves.toBe('side-panel-opened');

        await controls.commandOptions.openWallet({ windowId: 23 });
        expect(controls.openSidePanel).toHaveBeenLastCalledWith({ windowId: 23 });

        await controls.commandOptions.openWallet({});
        expect(controls.openSidePanel).toHaveBeenLastCalledWith({ windowId: -2 });
        expect(controls.readLayoutMode).toHaveBeenCalledTimes(1);

        controls.layoutMode = 'popup';
        await expect(controls.commandOptions.openWallet({ windowId: 7 }))
            .resolves.toBe('popup-opened');
        expect(controls.openPopup).toHaveBeenCalledOnce();
    });

    it('runs the keepalive only for the named alarm', () => {
        controls.alarmListener({ name: 'another-alarm' });
        expect(controls.keepaliveTick).not.toHaveBeenCalled();

        controls.alarmListener({ name: 'xchain-ws-keepalive' });
        expect(controls.keepaliveTick).toHaveBeenCalledOnce();
    });
});
