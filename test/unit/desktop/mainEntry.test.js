/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const electron = vi.hoisted(() => {
    const appListeners = new Map();
    const browserWindowOptions = [];
    const isolatedSession = { partition: 'trezor-connect-isolated' };
    const state = {
        userDataDir: '/tmp/xchain-main-entry-test',
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    class BrowserWindow {
        constructor(options) {
            browserWindowOptions.push(options);
            this.webContents = { send: vi.fn() };
            this.loadFile = vi.fn();
            this.once = vi.fn();
            this.on = vi.fn();
        }

        isDestroyed() { return false; }

        static getAllWindows() { return []; }

        static getFocusedWindow() { return null; }
    }
    return {
        appListeners,
        browserWindowOptions,
        isolatedSession,
        state,
        app: {
            isPackaged: true,
            getPath: vi.fn(() => state.userDataDir),
            getVersion: vi.fn(() => 'test-version'),
            on: vi.fn((name, listener) => { appListeners.set(name, listener); }),
            quit: vi.fn(),
            setAboutPanelOptions: vi.fn(),
            whenReady: vi.fn(() => new Promise(() => {})),
        },
        BrowserWindow,
        Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
        ipcMain: { handle: vi.fn() },
        safeStorage: {},
        screen: {
            getAllDisplays: vi.fn(() => [{ workArea: state.workArea }]),
            getPrimaryDisplay: vi.fn(() => ({ workArea: state.workArea })),
        },
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

const runtime = vi.hoisted(() => ({
    instance: { sessionBackend: { clear: vi.fn(async () => {}) } },
    createRuntime: vi.fn(),
    enforceIdleAutoLock: vi.fn(),
    enforceLaunchAutoLock: vi.fn(),
    ensureHost: vi.fn(),
    handleIpcMessage: vi.fn(),
    tearDownHost: vi.fn(),
    wipeRuntimeStores: vi.fn(),
}));

vi.mock('electron', () => electron);
vi.mock('@xchain-wallet/core', () => ({
    registry: { defaultRegistry: vi.fn(() => ({})) },
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
vi.mock('../../../packages/desktop/main/updater.js', () => ({
    attachUpdater: vi.fn(async () => ({
        checkForUpdates: vi.fn(),
        downloadAndInstall: vi.fn(),
        isActive: false,
    })),
}));
vi.mock('../../../packages/desktop/main/torRouting.js', () => ({ applyTorRouting: vi.fn() }));
vi.mock('../../../packages/desktop/main/runtime.js', () => runtime);

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

const tempDirs = [];

beforeEach(() => {
    electron.appListeners.clear();
    electron.browserWindowOptions.length = 0;
    electron.state.userDataDir = '/tmp/xchain-main-entry-test';
    electron.state.workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    vi.clearAllMocks();
    protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: true });
    runtime.createRuntime.mockReturnValue(runtime.instance);
    runtime.enforceLaunchAutoLock.mockResolvedValue({ locked: false });
    vi.resetModules();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

    it.each([
        {
            label: 'at the desktop default on a large display',
            workArea: { x: 0, y: 0, width: 1920, height: 1080 },
            expected: { width: 1024, height: 768 },
        },
        {
            label: 'clamped to a smaller primary work area',
            workArea: { x: 0, y: 0, width: 900, height: 700 },
            expected: { width: 900, height: 700 },
        },
    ])('opens the first window $label', async ({ workArea, expected }) => {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-entry-'));
        tempDirs.push(userDataDir);
        electron.state.userDataDir = userDataDir;
        electron.state.workArea = workArea;
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject({
            ...expected,
            minWidth: 640,
            minHeight: 600,
        });
    });

    it('honors persisted window bounds instead of the first-launch size', async () => {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-entry-'));
        tempDirs.push(userDataDir);
        const savedBounds = { x: 80, y: 60, width: 1180, height: 820 };
        writeFileSync(join(userDataDir, 'window-bounds.json'), JSON.stringify(savedBounds));
        electron.state.userDataDir = userDataDir;
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject(savedBounds);
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
