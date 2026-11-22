// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
    alarmListener: null,
    commandOptions: null,
    createToolbarView: vi.fn(),
    toolbarViewStart: vi.fn(),
    toolbarViewActivate: vi.fn(async (tab) => ({ activated: tab })),
    keepaliveTick: vi.fn(async () => {}),
    maybeAutoLock: vi.fn(async () => 'skipped'),
    openPopup: vi.fn(async () => 'popup-opened'),
    openSidePanel: vi.fn(async () => 'side-panel-opened'),
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
    createSessionSaveFence: vi.fn(() => ({
        track: (task) => task,
        beforeSave: vi.fn(async () => {}),
    })),
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
    attachPanicStateListener: vi.fn(() => () => {}),
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
    createUiRequestTracker: vi.fn(() => ({ begin: () => () => {}, isActive: () => false })),
    createLockBackstop: vi.fn(() => ({
        lockWalletNow: vi.fn(async () => {}),
        maybeAutoLock: controls.maybeAutoLock,
        noteUnlocked: vi.fn(),
        onLocked: vi.fn(),
    })),
}));
vi.mock('../../../packages/extension/src/bridge/bridgeEvents.js', () => ({
    createBridgeEventBroadcaster: vi.fn(),
}));
vi.mock('../../../packages/extension/src/background/layoutMode.js', () => ({
    createToolbarViewController: (...args) => {
        controls.createToolbarView(...args);
        return { start: controls.toolbarViewStart, activate: controls.toolbarViewActivate };
    },
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
    it('starts the toolbar view controller at boot and publishes SDK readiness', async () => {
        await expect(backgroundModule.sdkResolved).resolves.toBe('sdk');
        // Started in the first turn, so a waking click or port reaches it.
        expect(controls.createToolbarView).toHaveBeenCalledOnce();
        expect(controls.toolbarViewStart).toHaveBeenCalledOnce();
    });

    it('runs the open-wallet command through the toolbar view controller', async () => {
        await expect(controls.commandOptions.openWallet({ windowId: 7 }))
            .resolves.toEqual({ activated: { windowId: 7 } });
        expect(controls.toolbarViewActivate).toHaveBeenCalledWith({ windowId: 7 });
        expect(controls.openSidePanel).not.toHaveBeenCalled();
        expect(controls.openPopup).not.toHaveBeenCalled();
    });

    it('checks the idle deadline once at boot, before any keepalive alarm', async () => {
        await vi.waitFor(() => expect(controls.maybeAutoLock).toHaveBeenCalledOnce());
        expect(controls.keepaliveTick).not.toHaveBeenCalled();
    });

    it('runs the keepalive only for the named alarm', () => {
        controls.alarmListener({ name: 'another-alarm' });
        expect(controls.keepaliveTick).not.toHaveBeenCalled();

        controls.alarmListener({ name: 'xchain-ws-keepalive' });
        expect(controls.keepaliveTick).toHaveBeenCalledOnce();
    });
});
