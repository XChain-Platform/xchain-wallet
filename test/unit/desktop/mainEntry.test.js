/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const electron = vi.hoisted(() => {
    const appListeners = new Map();
    const isolatedSession = { partition: 'trezor-connect-isolated' };
    return {
        appListeners,
        isolatedSession,
        app: {
            isPackaged: true,
            on: vi.fn((name, listener) => { appListeners.set(name, listener); }),
            quit: vi.fn(),
            whenReady: vi.fn(() => new Promise(() => {})),
        },
        BrowserWindow: class BrowserWindow {},
        Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
        ipcMain: { handle: vi.fn() },
        safeStorage: {},
        session: {
            defaultSession: {},
            fromPartition: vi.fn(() => isolatedSession),
        },
        shell: { openExternal: vi.fn(async () => {}) },
        Notification: class Notification {},
    };
});

const protocol = vi.hoisted(() => ({
    attachDeepLinkHandlers: vi.fn(() => ({ gotLock: true })),
    createDeepLinkSlot: vi.fn(() => ({ offer: vi.fn(), take: vi.fn() })),
    pickDeepLinkTarget: vi.fn(),
    registerProtocolClients: vi.fn(),
}));

const permissions = vi.hoisted(() => ({
    attachHidPermissions: vi.fn(),
    attachHidDenial: vi.fn(),
    observeHidFrames: vi.fn(),
}));

vi.mock('electron', () => electron);
vi.mock('@xchain-wallet/core', () => ({
    registry: {},
    sdk: {
        adaptXChainSDK: vi.fn(() => vi.fn()),
        SDKRegistry: class SDKRegistry {},
    },
}));
vi.mock('@xchain-wallet/core/buildInfo.js', () => ({ WALLET_VERSION: 'test-version' }));
vi.mock('xchain-sdk', () => ({ XChainSDK: class XChainSDK {} }));
vi.mock('../../../packages/desktop/main/messageHost.js', () => ({
    IPC_CHANNEL: 'xchain-wallet:message',
}));
vi.mock('../../../packages/desktop/main/storage.js', () => ({
    FileStorageBackend: class FileStorageBackend {},
    vaultPathFor: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/meta.js', () => ({
    FileMetaBackend: class FileMetaBackend {},
    metaPathFor: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/keychain.js', () => ({
    KeychainSessionBackend: class KeychainSessionBackend {},
    sessionKeyPathFor: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/unlockThrottle.js', () => ({
    FileUnlockThrottleStore: class FileUnlockThrottleStore {},
    unlockThrottlePathFor: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/autoLockState.js', () => ({
    FileAutoLockStore: class FileAutoLockStore {},
    autoLockStatePathFor: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/permissions.js', () => permissions);
vi.mock('../../../packages/desktop/main/protocol.js', () => protocol);
vi.mock('../../../packages/desktop/main/signerBridgeListener.js', () => ({
    attachSignerBridgeListener: vi.fn(),
}));
vi.mock('../../../packages/desktop/main/updater.js', () => ({ attachUpdater: vi.fn() }));
vi.mock('../../../packages/desktop/main/torRouting.js', () => ({ applyTorRouting: vi.fn() }));
vi.mock('../../../packages/desktop/main/runtime.js', () => ({
    createRuntime: vi.fn(),
    enforceIdleAutoLock: vi.fn(),
    enforceLaunchAutoLock: vi.fn(),
    ensureHost: vi.fn(),
    handleIpcMessage: vi.fn(),
    tearDownHost: vi.fn(),
    wipeRuntimeStores: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const appIndex = pathToFileURL(join(
    here,
    '..',
    '..',
    '..',
    'packages',
    'desktop',
    'renderer',
    'dist',
    'index.html',
)).href;

beforeEach(() => {
    electron.appListeners.clear();
    vi.clearAllMocks();
    protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: true });
    vi.resetModules();
});

describe('desktop main entry point', () => {
    it('registers Electron lifecycle and deep-link handlers at import time', async () => {
        await import('../../../packages/desktop/main/index.js');

        expect(electron.app.on.mock.calls.map(([name]) => name)).toEqual([
            'web-contents-created',
            'window-all-closed',
            'before-quit',
        ]);
        expect(protocol.attachDeepLinkHandlers).toHaveBeenCalledOnce();
        expect(protocol.attachDeepLinkHandlers.mock.calls[0][0]).toBe(electron.app);
        expect(protocol.attachDeepLinkHandlers.mock.calls[0][1].onDeepLink).toBeTypeOf('function');
        expect(electron.app.whenReady).toHaveBeenCalledOnce();
        expect(electron.app.quit).not.toHaveBeenCalled();
    });

    it('quits when another Electron instance owns the application lock', async () => {
        protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: false });

        await import('../../../packages/desktop/main/index.js');

        expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    it('hardens every Electron webContents and opens external links outside the wallet', async () => {
        await import('../../../packages/desktop/main/index.js');
        const handlers = new Map();
        let openHandler;
        const contents = {
            session: electron.session.defaultSession,
            getURL: () => appIndex,
            setWindowOpenHandler: vi.fn((handler) => { openHandler = handler; }),
            on: vi.fn((name, handler) => { handlers.set(name, handler); }),
        };

        electron.appListeners.get('web-contents-created')({}, contents);

        expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce();
        expect(permissions.observeHidFrames).toHaveBeenCalledWith(contents);
        expect(openHandler({ url: 'https://example.com', frameName: '' })).toEqual({ action: 'deny' });
        expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com');

        const navigation = { preventDefault: vi.fn() };
        handlers.get('will-navigate')(navigation, 'file:///tmp/untrusted.html');
        expect(navigation.preventDefault).toHaveBeenCalledOnce();

        const webview = { preventDefault: vi.fn() };
        handlers.get('will-attach-webview')(webview);
        expect(webview.preventDefault).toHaveBeenCalledOnce();
    });

    it('allows only the marked Trezor bridge in an isolated no-HID session', async () => {
        await import('../../../packages/desktop/main/index.js');
        let openHandler;
        const contents = {
            session: electron.session.defaultSession,
            getURL: () => appIndex,
            setWindowOpenHandler: (handler) => { openHandler = handler; },
            on: vi.fn(),
        };
        electron.appListeners.get('web-contents-created')({}, contents);

        const result = openHandler({
            url: 'https://connect.trezor.io/',
            frameName: 'xchain-trezor-connect-bridge',
        });

        expect(result.action).toBe('allow');
        expect(result.overrideBrowserWindowOptions.webPreferences).toMatchObject({
            session: electron.isolatedSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: false,
        });
        expect(result.overrideBrowserWindowOptions.webPreferences).not.toHaveProperty('preload');
        expect(electron.session.fromPartition).toHaveBeenCalledExactlyOnceWith('trezor-connect-isolated');
        expect(permissions.attachHidDenial).toHaveBeenCalledExactlyOnceWith(electron.isolatedSession);
    });
});
