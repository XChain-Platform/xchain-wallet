/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const electron = vi.hoisted(() => {
    const appListeners = new Map();
    const powerMonitorListeners = new Map();
    const browserWindowOptions = [];
    const ipcHandlers = new Map();
    const isolatedSession = { partition: 'trezor-connect-isolated' };
    const state = {
        userDataDir: '/tmp/xchain-main-entry-test',
        displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        normalBounds: { x: 0, y: 0, width: 1024, height: 768 },
        loadFileError: null,
    };
    const ownerWindow = {};
    const popup = vi.fn();
    const webRequest = { onHeadersReceived: vi.fn() };
    class BrowserWindow {
        static instances = [];
        static fromWebContents = vi.fn((contents) => (
            BrowserWindow.instances.find((win) => win.webContents === contents) ?? ownerWindow
        ));

        constructor(options) {
            browserWindowOptions.push(options);
            this.options = options;
            this.webContents = {
                send: vi.fn(),
                setVisualZoomLevelLimits: vi.fn(async () => {}),
                isDestroyed: vi.fn(() => false),
                reload: vi.fn(),
                reloadIgnoringCache: vi.fn(),
                ipc: { on: vi.fn() },
                bridgeListeners: new Map(),
            };
            this.webContents.on = vi.fn((name, listener) => { this.webContents.bridgeListeners.set(name, listener); });
            this.loadFile = vi.fn(() => state.loadFileError
                ? Promise.reject(state.loadFileError)
                : undefined);
            this.once = vi.fn();
            this.on = vi.fn();
            this.isDestroyed = vi.fn(() => false);
            this.isMinimized = vi.fn(() => false);
            this.isVisible = vi.fn(() => true);
            this.show = vi.fn();
            this.hide = vi.fn();
            this.restore = vi.fn();
            this.show = vi.fn();
            this.focus = vi.fn();
            this.getNormalBounds = vi.fn(() => state.normalBounds);
            BrowserWindow.instances.push(this);
        }

        static getAllWindows() {
            return BrowserWindow.instances;
        }

        static getFocusedWindow() { return null; }
    }
    class Tray {
        static instances = [];

        constructor(image) {
            this.image = image;
            this.setToolTip = vi.fn();
            this.setContextMenu = vi.fn();
            this.on = vi.fn();
            this.destroy = vi.fn();
            Tray.instances.push(this);
        }
    }
    return {
        appListeners,
        powerMonitorListeners,
        browserWindowOptions,
        ipcHandlers,
        isolatedSession,
        ownerWindow,
        popup,
        webRequest,
        state,
        app: {
            isPackaged: true,
            getPath: vi.fn(() => state.userDataDir),
            getVersion: vi.fn(() => 'test-version'),
            on: vi.fn((name, listener) => { appListeners.set(name, listener); }),
            quit: vi.fn(),
            setAboutPanelOptions: vi.fn(),
            showAboutPanel: vi.fn(),
            whenReady: vi.fn(() => new Promise(() => {})),
        },
        BrowserWindow,
        Tray,
        Menu: {
            buildFromTemplate: vi.fn(() => ({ popup })),
            setApplicationMenu: vi.fn(),
        },
        ipcMain: { handle: vi.fn((name, handler) => { ipcHandlers.set(name, handler); }) },
        powerMonitor: {
            on: vi.fn((name, listener) => { powerMonitorListeners.set(name, listener); }),
        },
        safeStorage: {},
        screen: {
            getAllDisplays: vi.fn(() => state.displays),
            getPrimaryDisplay: vi.fn(() => state.displays[0]),
        },
        session: {
            defaultSession: { webRequest },
            fromPartition: vi.fn(() => isolatedSession),
        },
        shell: { openExternal: vi.fn(async () => {}) },
        dialog: { showMessageBoxSync: vi.fn(() => 0) },
        Notification: class Notification {},
    };
});

const protocol = vi.hoisted(() => ({
    attachDeepLinkHandlers: vi.fn(() => ({ gotLock: true })),
    deepLinkSlot: { offer: vi.fn(), take: vi.fn() },
    createDeepLinkSlot: vi.fn(),
    focusDeepLinkTarget: vi.fn(),
    pickDeepLinkTarget: vi.fn(),
    registerProtocolClients: vi.fn(),
}));

protocol.createDeepLinkSlot.mockReturnValue(protocol.deepLinkSlot);

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
    enforceSystemAutoLock: vi.fn(),
    ensureHost: vi.fn(),
    handleIpcMessage: vi.fn(),
    installPanicModePersistence: vi.fn(async () => {}),
    tearDownHost: vi.fn(),
    wipeRuntimeStores: vi.fn(),
}));

const updater = vi.hoisted(() => ({
    attachUpdater: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadAndInstall: vi.fn(),
    restartAndInstall: vi.fn(),
}));

// Pass-through fs whose synchronous write the bounds tests can watch and fail.
const fsControl = vi.hoisted(() => ({ failSyncWrite: false, writeFileSync: null }));
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal();
    const writeFileSync = vi.fn((...args) => {
        if (fsControl.failSyncWrite) throw new Error('disk full');
        return actual.writeFileSync(...args);
    });
    fsControl.writeFileSync = writeFileSync;
    return { ...actual, default: { ...actual, writeFileSync }, writeFileSync };
});

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
    attachUpdater: updater.attachUpdater,
}));
vi.mock('../../../packages/desktop/main/torRouting.js', () => ({ applyTorRouting: vi.fn(), applyProxyToSession: vi.fn(async () => {}) }));
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
    electron.powerMonitorListeners.clear();
    electron.browserWindowOptions.length = 0;
    electron.ipcHandlers.clear();
    electron.state.userDataDir = '/tmp/xchain-main-entry-test';
    electron.state.displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    electron.state.normalBounds = { x: 0, y: 0, width: 1024, height: 768 };
    electron.state.loadFileError = null;
    fsControl.failSyncWrite = false;
    electron.BrowserWindow.instances.length = 0;
    electron.Tray.instances.length = 0;
    electron.app.isPackaged = true;
    vi.clearAllMocks();
    protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: true });
    runtime.createRuntime.mockReturnValue(runtime.instance);
    runtime.enforceLaunchAutoLock.mockResolvedValue({ locked: false });
    runtime.enforceIdleAutoLock.mockResolvedValue({ locked: false });
    runtime.enforceSystemAutoLock.mockResolvedValue({ locked: true, reason: 'system-event' });
    updater.attachUpdater.mockResolvedValue({
        checkForUpdates: updater.checkForUpdates,
        downloadUpdate: updater.downloadAndInstall,
        restartAndInstall: updater.restartAndInstall,
        isActive: false,
    });
    vi.resetModules();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('desktop main entry point', () => {
    it('sets a restrictive CSP response header on packaged renderer files', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.webRequest.onHeadersReceived).toHaveBeenCalledOnce());

        const [filter, handler] = electron.webRequest.onHeadersReceived.mock.calls[0];
        expect(filter).toEqual({ urls: ['file://*/*'] });
        const callback = vi.fn();
        handler({
            url: appIndex,
            responseHeaders: {
                'content-security-policy': ["default-src *; script-src 'unsafe-inline' 'unsafe-eval'"],
                'X-Content-Type-Options': ['nosniff'],
            },
        }, callback);

        const headers = callback.mock.calls[0][0].responseHeaders;
        expect(headers['X-Content-Type-Options']).toEqual(['nosniff']);
        const policy = headers['Content-Security-Policy'][0];
        const directives = Object.fromEntries(policy.split(';').map((directive) => {
            const [name, ...sources] = directive.trim().split(/\s+/);
            return [name, sources];
        }));
        expect(directives['script-src']).toEqual(["'self'"]);
        expect(policy).not.toContain("'unsafe-eval'");
        expect(directives['connect-src']).toEqual(["'self'"]);
        expect(directives['frame-ancestors']).toEqual(["'none'"]);
        // Let the ready flow finish here, or its first window lands in the next
        // test after that test has reset the window list.
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
    });

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
        expect(protocol.attachDeepLinkHandlers.mock.calls[0][1].onSecondInstance).toBeTypeOf('function');
        expect(electron.app.whenReady).toHaveBeenCalledOnce();
        expect(electron.app.quit).not.toHaveBeenCalled();
    });

    it('quits when another Electron instance owns the application lock', async () => {
        protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: false });

        await import('../../../packages/desktop/main/index.js');

        expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    it.each(['lock-screen', 'suspend'])('locks and notifies renderers on Electron %s', async (eventName) => {
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.powerMonitorListeners.has(eventName)).toBe(true));
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));

        electron.powerMonitorListeners.get(eventName)();

        await vi.waitFor(() => expect(runtime.enforceSystemAutoLock).toHaveBeenCalledWith(runtime.instance));
        expect(electron.BrowserWindow.instances[0].webContents.send).toHaveBeenCalledWith(
            'xchain:state-changed',
            { kind: 'session' },
        );
    });

    it('contains startup rejection and opens a window for retry', async () => {
        const secret = 'private startup path';
        electron.app.whenReady.mockRejectedValueOnce(new Error(secret));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));

        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] desktop startup failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
        expect(electron.webRequest.onHeadersReceived).toHaveBeenCalledOnce();
        error.mockRestore();
    });

    it('parks an Electron deep link until a renderer can claim it', async () => {
        await import('../../../packages/desktop/main/index.js');
        const event = {
            scheme: 'dogecoin',
            raw: 'dogecoin:DRecipient?amount=3',
            parsed: { address: 'DRecipient', amount: '3' },
        };

        protocol.attachDeepLinkHandlers.mock.calls[0][1].onDeepLink(event);

        expect(protocol.deepLinkSlot.offer).toHaveBeenCalledExactlyOnceWith(event);
    });

    it('lets only the selected primary window claim a parked deep link', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        const main = await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const selected = electron.BrowserWindow.instances[0];
        const sibling = main.createWindow();
        const detached = main.createWindow({ initialView: 'history' });
        const link = {
            scheme: 'dogecoin',
            raw: 'dogecoin:DRecipient?amount=3',
            parsed: { address: 'DRecipient', amount: '3' },
        };
        protocol.pickDeepLinkTarget.mockReturnValue(selected);
        protocol.deepLinkSlot.take.mockReturnValue(link);
        protocol.attachDeepLinkHandlers.mock.calls[0][1].onDeepLink(link);
        const takePending = electron.ipcMain.handle.mock.calls
            .find(([channel]) => channel === 'xchain:deep-link-take')[1];
        const invokeFrom = (win) => takePending({
            sender: win.webContents,
            senderFrame: { url: appIndex },
        });

        await expect(invokeFrom(sibling)).resolves.toBeNull();
        await expect(invokeFrom(detached)).resolves.toBeNull();
        expect(protocol.deepLinkSlot.take).not.toHaveBeenCalled();
        await expect(invokeFrom(selected)).resolves.toEqual(link);
        expect(protocol.deepLinkSlot.take).toHaveBeenCalledOnce();
    });

    it('returns no pending deep link when claiming the slot throws', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const sender = electron.BrowserWindow.instances[0];
        protocol.deepLinkSlot.take.mockImplementationOnce(() => {
            throw new Error('private link payload');
        });
        const takePending = electron.ipcMain.handle.mock.calls
            .find(([channel]) => channel === 'xchain:deep-link-take')[1];

        await expect(takePending({
            sender: sender.webContents,
            senderFrame: { url: appIndex },
        })).resolves.toBeNull();
        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] deep-link IPC action failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain('private link payload');
        error.mockRestore();
    });

    it('registers plain updater fallbacks when updater wiring rejects', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        updater.attachUpdater.mockRejectedValueOnce(new Error('private updater path'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const handlers = new Map(electron.ipcMain.handle.mock.calls);
        const event = {
            sender: electron.BrowserWindow.instances[0].webContents,
            senderFrame: { url: appIndex },
        };

        await expect(handlers.get('xchain:updater-state')(event)).resolves.toBeNull();
        await expect(handlers.get('xchain:updater-install')(event, 'check')).resolves.toEqual({
            ok: false,
            reason: 'desktop: updater unavailable',
        });
        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] updater wiring failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain('private updater path');
        error.mockRestore();
    });

    it('returns a committed message result when a sibling closes during notification', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        const main = await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const sender = electron.BrowserWindow.instances[0];
        const closingSibling = main.createWindow();
        closingSibling.webContents.send.mockImplementation(() => {
            throw new Error('Object has been destroyed');
        });
        const response = { ok: true, result: { walletId: 'wallet-2' } };
        runtime.handleIpcMessage.mockResolvedValue(response);
        const handleMessage = electron.ipcMain.handle.mock.calls
            .find(([channel]) => channel === 'xchain-wallet:message')[1];

        await expect(handleMessage({
            sender: sender.webContents,
            senderFrame: { url: appIndex },
        }, {
            type: 'wallet.setActive',
            request: { walletId: 'wallet-2' },
        })).resolves.toEqual(response);
        expect(closingSibling.webContents.send).toHaveBeenCalledWith(
            'xchain:state-changed',
            { kind: 'active-wallet', walletId: 'wallet-2' },
        );
    });

    it('tells sibling windows to re-read the session when a wipe fails after the host is torn down', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        const main = await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const sender = electron.BrowserWindow.instances[0];
        const sibling = main.createWindow();
        runtime.wipeRuntimeStores.mockResolvedValue({
            ok: false,
            cleared: [],
            errors: [{ store: 'meta', message: 'EPERM: operation not permitted' }],
        });
        const wipe = electron.ipcMain.handle.mock.calls
            .find(([channel]) => channel === 'xchain:wipe-storage')[1];

        const result = await wipe({ sender: sender.webContents, senderFrame: { url: appIndex } });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/meta: EPERM/);
        expect(sibling.webContents.send).toHaveBeenCalledWith('xchain:state-changed', { kind: 'session' });
        expect(sender.webContents.send).not.toHaveBeenCalledWith('xchain:state-changed', { kind: 'session' });
    });

    it('restores, shows, and focuses the Electron window receiving a link', async () => {
        const { focusDeepLinkTarget } = await vi.importActual(
            '../../../packages/desktop/main/protocol.js',
        );
        const win = {
            isMinimized: vi.fn(() => true),
            restore: vi.fn(),
            isVisible: vi.fn(() => false),
            show: vi.fn(),
            focus: vi.fn(),
        };

        focusDeepLinkTarget(win);

        expect(win.restore).toHaveBeenCalledOnce();
        expect(win.show).toHaveBeenCalledOnce();
        expect(win.focus).toHaveBeenCalledOnce();
        expect(win.restore.mock.invocationCallOrder[0]).toBeLessThan(win.focus.mock.invocationCallOrder[0]);
        expect(win.show.mock.invocationCallOrder[0]).toBeLessThan(win.focus.mock.invocationCallOrder[0]);
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
        electron.state.displays = [{ workArea }];
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject({
            ...expected,
            minWidth: 360,
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

    it.each([
        {
            label: 'off every connected display',
            savedBounds: { x: 4000, y: 3000, width: 900, height: 700 },
            expected: { width: 900, height: 700 },
        },
        {
            label: 'too small to be usable',
            savedBounds: { x: 80, y: 60, width: 100, height: 100 },
            expected: { width: 1024, height: 768 },
        },
    ])('drops an unusable saved position when it is $label', async ({ savedBounds, expected }) => {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-entry-'));
        tempDirs.push(userDataDir);
        writeFileSync(join(userDataDir, 'window-bounds.json'), JSON.stringify(savedBounds));
        electron.state.userDataDir = userDataDir;
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject(expected);
        expect(electron.browserWindowOptions[0]).not.toHaveProperty('x');
        expect(electron.browserWindowOptions[0]).not.toHaveProperty('y');
    });

    it('restores the saved position on one ultrawide display', async () => {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-entry-'));
        tempDirs.push(userDataDir);
        const savedBounds = { x: 400, y: 200, width: 900, height: 700 };
        writeFileSync(join(userDataDir, 'window-bounds.json'), JSON.stringify(savedBounds));
        electron.state.userDataDir = userDataDir;
        electron.state.displays = [{
            workArea: { x: 0, y: 0, width: 5120, height: 1440 },
            scaleFactor: 2,
        }];
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject(savedBounds);
    });

    it('clamps saved bounds inside the display containing their origin', async () => {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-entry-'));
        tempDirs.push(userDataDir);
        const savedBounds = { x: 1800, y: 200, width: 900, height: 700 };
        writeFileSync(join(userDataDir, 'window-bounds.json'), JSON.stringify(savedBounds));
        electron.state.userDataDir = userDataDir;
        electron.state.displays = [
            { workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
            { workArea: { x: 1920, y: 0, width: 3200, height: 1440 }, scaleFactor: 2 },
        ];
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(1));

        expect(electron.browserWindowOptions[0]).toMatchObject({
            ...savedBounds,
            x: 1020,
        });
    });

    it.each(['darwin', 'win32', 'linux'])('hides on %s close, permits an explicit quit, and reveals hidden windows', async (platform) => {
        const { applyWindowCloseConvention, revealWindow } = await import('../../../packages/desktop/main/index.js');
        const event = { preventDefault: vi.fn() };
        const win = {
            hide: vi.fn(),
            show: vi.fn(),
            focus: vi.fn(),
            restore: vi.fn(),
            isDestroyed: vi.fn(() => false),
            isMinimized: vi.fn(() => true),
            isVisible: vi.fn(() => false),
        };

        expect(applyWindowCloseConvention(win, event, { platform, quitting: false })).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(win.hide).toHaveBeenCalledOnce();

        event.preventDefault.mockClear();
        win.hide.mockClear();
        expect(applyWindowCloseConvention(win, event, { platform: 'darwin', quitting: true })).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(win.hide).not.toHaveBeenCalled();

        expect(revealWindow(win)).toBe(true);
        expect(win.restore).toHaveBeenCalledOnce();
        expect(win.show).toHaveBeenCalledOnce();
        expect(win.focus).toHaveBeenCalledOnce();
    });

    it.each(['darwin', 'win32', 'linux'])('tells the %s renderer its window hid on close', async (platform) => {
        const { applyWindowCloseConvention } = await import('../../../packages/desktop/main/index.js');
        const send = vi.fn();
        const win = {
            hide: vi.fn(),
            isDestroyed: vi.fn(() => false),
            webContents: { send, isDestroyed: vi.fn(() => false) },
        };

        expect(applyWindowCloseConvention(win, { preventDefault: vi.fn() }, {
            platform, quitting: false, otherVisible: false, detached: false,
        })).toBe(true);

        expect(send).toHaveBeenCalledWith('xchain:window-hidden');
    });

    it.each(['win32', 'linux'])('restores a hidden window from the %s tray', async (platform) => {
        const { installTray } = await import('../../../packages/desktop/main/index.js');
        const win = new electron.BrowserWindow({});
        win.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        const tray = installTray({ platform });
        const menu = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        menu[0].click();

        await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
        expect(win.focus).toHaveBeenCalledOnce();
        win.isVisible.mockReturnValue(true);
        const click = tray.on.mock.calls.find(([name]) => name === 'click')[1];
        click();

        await vi.waitFor(() => expect(win.focus).toHaveBeenCalledTimes(2));
        expect(win.show).toHaveBeenCalledOnce();
    });

    it.each(['darwin', 'win32', 'linux'])('closes a %s window for real while another window is still visible', async (platform) => {
        const { applyWindowCloseConvention } = await import('../../../packages/desktop/main/index.js');
        const win = { hide: vi.fn() };
        for (const options of [{ otherVisible: true, detached: false }, { otherVisible: false, detached: true }]) {
            const event = { preventDefault: vi.fn() };
            expect(applyWindowCloseConvention(win, event, { platform, quitting: false, ...options })).toBe(false);
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
        expect(win.hide).not.toHaveBeenCalled();
    });

    it.each(['darwin', 'win32', 'linux'])('hides only the last of two %s windows on close', async (platform) => {
        const original = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: platform });
        try {
            const { createWindow } = await import('../../../packages/desktop/main/index.js');
            const first = createWindow();
            const second = createWindow();
            const closeOf = (win) => win.on.mock.calls.find(([name]) => name === 'close')[1];

            const firstClose = { preventDefault: vi.fn() };
            closeOf(first)(firstClose);
            expect(firstClose.preventDefault).not.toHaveBeenCalled();
            expect(first.hide).not.toHaveBeenCalled();
            first.isDestroyed.mockReturnValue(true);

            const lastClose = { preventDefault: vi.fn() };
            closeOf(second)(lastClose);
            expect(lastClose.preventDefault).toHaveBeenCalledOnce();
            expect(second.hide).toHaveBeenCalledOnce();
        } finally {
            Object.defineProperty(process, 'platform', original);
        }
    });

    it.each(['win32', 'linux'])('keeps a %s app in the tray when its windows close and removes the tray on quit', async (platform) => {
        const original = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: platform });
        try {
            electron.app.whenReady.mockResolvedValueOnce();
            await import('../../../packages/desktop/main/index.js');
            await vi.waitFor(() => expect(electron.Tray.instances).toHaveLength(1));
            const [tray] = electron.Tray.instances;
            expect(tray.image).toMatch(/build[\\/]icon\.png$/);

            electron.appListeners.get('window-all-closed')();
            expect(electron.app.quit).not.toHaveBeenCalled();

            electron.appListeners.get('before-quit')({ preventDefault: vi.fn() });
            expect(tray.destroy).toHaveBeenCalledOnce();
            expect(runtime.tearDownHost).toHaveBeenCalled();
        } finally {
            Object.defineProperty(process, 'platform', original);
        }
    });

    it('adds no tray on macOS, where the dock reopens the app', async () => {
        const { installTray } = await import('../../../packages/desktop/main/index.js');
        expect(installTray({ platform: 'darwin' })).toBeNull();
        expect(electron.Tray.instances).toHaveLength(0);
    });

    it('quits on the next request once a deferring send has settled', async () => {
        let finishSend;
        runtime.handleIpcMessage.mockImplementationOnce(() => new Promise((resolve) => {
            finishSend = resolve;
        }));
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain-wallet:message')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        const sending = electron.ipcHandlers.get('xchain-wallet:message')({
            senderFrame: { url: appIndex },
            sender: win.webContents,
        }, { type: 'action.send', request: {} });
        const deferred = { preventDefault: vi.fn() };
        electron.appListeners.get('before-quit')(deferred);
        expect(deferred.preventDefault).toHaveBeenCalledOnce();

        finishSend({ ok: true });
        await sending;
        const retried = { preventDefault: vi.fn() };
        electron.appListeners.get('before-quit')(retried);
        expect(retried.preventDefault).not.toHaveBeenCalled();
        expect(runtime.tearDownHost).toHaveBeenCalledOnce();
    });

    it('hands a deep link to the window a restore already under way opens', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        let finishIdleCheck;
        runtime.enforceIdleAutoLock.mockImplementationOnce(() => new Promise((resolve) => {
            finishIdleCheck = resolve;
        }));
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.appListeners.has('activate')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        win.isVisible.mockReturnValue(false);
        // The dock restore is waiting on its idle check when the link lands,
        // and only then does the primary window become the link target.
        protocol.pickDeepLinkTarget.mockReturnValue(null);
        electron.appListeners.get('activate')();
        await vi.waitFor(() => expect(runtime.enforceIdleAutoLock).toHaveBeenCalledOnce());
        const handlers = protocol.attachDeepLinkHandlers.mock.calls[0][1];
        const event = { scheme: 'bitcoin', raw: 'bitcoin:recipient', parsed: null };
        handlers.onDeepLink(event);

        protocol.pickDeepLinkTarget.mockReturnValue(win);
        win.isVisible.mockReturnValue(true);
        finishIdleCheck({ locked: false });

        await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledWith('xchain:uri', event));
        expect(electron.BrowserWindow.instances).toHaveLength(1);
        expect(runtime.enforceIdleAutoLock).toHaveBeenCalledOnce();
    });

    it('restores a hidden macOS window from the dock', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.appListeners.has('activate')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        win.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        electron.appListeners.get('activate')();

        await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
        expect(win.focus).toHaveBeenCalledOnce();
    });

    it('delivers a second-instance deep link after restoring a hidden window', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const win = electron.BrowserWindow.instances[0];
        win.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(win);
        const handlers = protocol.attachDeepLinkHandlers.mock.calls[0][1];
        const event = { scheme: 'xchain', raw: 'xchain:send?to=recipient', parsed: null };

        handlers.onSecondInstance();
        handlers.onDeepLink(event);

        await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledWith('xchain:uri', event));
        expect(protocol.deepLinkSlot.offer).toHaveBeenCalledExactlyOnceWith(event);
        expect(win.show).toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalled();
    });

    it('opens a primary window for a deep link when only a detached window survives', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        const { createWindow } = await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        electron.BrowserWindow.instances[0].isDestroyed.mockReturnValue(true);
        const detached = createWindow({ initialView: 'history', initialContext: { txid: 'pending' } });
        detached.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(null);
        const handlers = protocol.attachDeepLinkHandlers.mock.calls[0][1];
        const event = { scheme: 'xchain', raw: 'xchain:send?to=recipient', parsed: null };

        handlers.onSecondInstance();
        handlers.onDeepLink(event);

        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(3));
        expect(protocol.deepLinkSlot.offer).toHaveBeenCalledExactlyOnceWith(event);
        expect(detached.show).toHaveBeenCalled();
        expect(electron.BrowserWindow.instances[2].loadFile).toHaveBeenCalledWith(
            expect.any(String),
            {},
        );
    });

    it('defers quit during an update download and restores a usable window', async () => {
        let finishDownload;
        updater.downloadAndInstall.mockImplementationOnce(() => new Promise((resolve) => {
            finishDownload = resolve;
        }));
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain:updater-install')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        win.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        const downloading = electron.ipcHandlers.get('xchain:updater-install')({
            senderFrame: { url: appIndex },
        }, 'download');
        const quitEvent = { preventDefault: vi.fn() };
        electron.appListeners.get('before-quit')(quitEvent);

        expect(quitEvent.preventDefault).toHaveBeenCalledOnce();
        expect(runtime.tearDownHost).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
        expect(electron.app.quit).not.toHaveBeenCalled();
        finishDownload({ ok: true });
        await downloading;
        expect(electron.app.quit).toHaveBeenCalledOnce();
    });

    it('defers quit while a wallet send request is in flight', async () => {
        let finishSend;
        runtime.handleIpcMessage.mockImplementationOnce(() => new Promise((resolve) => {
            finishSend = resolve;
        }));
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain-wallet:message')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        win.isVisible.mockReturnValue(false);
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        const sending = electron.ipcHandlers.get('xchain-wallet:message')({
            senderFrame: { url: appIndex },
            sender: win.webContents,
        }, { type: 'action.send', request: {} });
        const quitEvent = { preventDefault: vi.fn() };
        electron.appListeners.get('before-quit')(quitEvent);

        expect(quitEvent.preventDefault).toHaveBeenCalledOnce();
        expect(runtime.tearDownHost).not.toHaveBeenCalled();
        expect(electron.app.quit).not.toHaveBeenCalled();
        finishSend({ ok: true });
        await sending;

        // The settled send re-issues the quit, and that quit goes through.
        expect(electron.app.quit).toHaveBeenCalledOnce();
        const retried = { preventDefault: vi.fn() };
        electron.appListeners.get('before-quit')(retried);
        expect(retried.preventDefault).not.toHaveBeenCalled();
        expect(runtime.tearDownHost).toHaveBeenCalledOnce();
    });

    it('quits at the deadline when a send never settles, whatever further quits arrive', async () => {
        runtime.handleIpcMessage.mockImplementationOnce(() => new Promise(() => {}));
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain-wallet:message')).toBe(true));
        const win = electron.BrowserWindow.instances[0];
        protocol.pickDeepLinkTarget.mockReturnValue(win);

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            void electron.ipcHandlers.get('xchain-wallet:message')({
                senderFrame: { url: appIndex },
                sender: win.webContents,
            }, { type: 'action.send', request: {} });
            const first = { preventDefault: vi.fn() };
            electron.appListeners.get('before-quit')(first);
            expect(first.preventDefault).toHaveBeenCalledOnce();

            // A second quit (another Cmd+Q, or SIGTERM) waits on the same
            // clock instead of starting a new one.
            vi.advanceTimersByTime(10_000);
            const second = { preventDefault: vi.fn() };
            electron.appListeners.get('before-quit')(second);
            expect(second.preventDefault).toHaveBeenCalledOnce();
            expect(electron.app.quit).not.toHaveBeenCalled();

            vi.advanceTimersByTime(5_000);
            expect(electron.app.quit).toHaveBeenCalledOnce();
            const forced = { preventDefault: vi.fn() };
            electron.appListeners.get('before-quit')(forced);
            expect(forced.preventDefault).not.toHaveBeenCalled();
            expect(runtime.tearDownHost).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['balances.wallet', 'history.address', 'settings.get', 'action.composeForConfirm'])(
        'never defers quit for a pending %s read',
        async (type) => {
            runtime.handleIpcMessage.mockImplementationOnce(() => new Promise(() => {}));
            electron.app.whenReady.mockResolvedValueOnce();
            await import('../../../packages/desktop/main/index.js');
            await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain-wallet:message')).toBe(true));
            const win = electron.BrowserWindow.instances[0];

            void electron.ipcHandlers.get('xchain-wallet:message')({
                senderFrame: { url: appIndex },
                sender: win.webContents,
            }, { type, request: {} });
            const quitEvent = { preventDefault: vi.fn() };
            electron.appListeners.get('before-quit')(quitEvent);

            expect(quitEvent.preventDefault).not.toHaveBeenCalled();
            expect(runtime.tearDownHost).toHaveBeenCalledOnce();
        },
    );

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
        expect(openHandler({
            url: 'HTTPS://Example.COM/docs?q=one two',
            frameName: '',
        })).toEqual({ action: 'deny' });
        expect(electron.shell.openExternal)
            .toHaveBeenCalledExactlyOnceWith('https://example.com/docs?q=one%20two');

        expect(openHandler({
            url: 'https://trusted.example@evil.example/',
            frameName: '',
        })).toEqual({ action: 'deny' });
        expect(openHandler({ url: 'file:///tmp/untrusted.html', frameName: '' }))
            .toEqual({ action: 'deny' });
        expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);

        const navigation = { preventDefault: vi.fn() };
        handlers.get('will-navigate')(navigation, 'file:///tmp/untrusted.html');
        expect(navigation.preventDefault).toHaveBeenCalledOnce();

        const webview = { preventDefault: vi.fn() };
        handlers.get('will-attach-webview')(webview);
        expect(webview.preventDefault).toHaveBeenCalledOnce();
    });

    it('lets a quit past a page that cancels its unload and asks before any other unload', async () => {
        await import('../../../packages/desktop/main/index.js');
        const handlers = new Map();
        const contents = {
            session: electron.session.defaultSession,
            getURL: () => appIndex,
            setWindowOpenHandler: vi.fn(),
            on: vi.fn((name, handler) => { handlers.set(name, handler); }),
        };
        electron.appListeners.get('web-contents-created')({}, contents);

        const stay = { preventDefault: vi.fn() };
        electron.dialog.showMessageBoxSync.mockReturnValueOnce(0);
        handlers.get('will-prevent-unload')(stay);
        expect(electron.dialog.showMessageBoxSync).toHaveBeenCalledOnce();
        expect(stay.preventDefault).not.toHaveBeenCalled();

        const leave = { preventDefault: vi.fn() };
        electron.dialog.showMessageBoxSync.mockReturnValueOnce(1);
        handlers.get('will-prevent-unload')(leave);
        expect(leave.preventDefault).toHaveBeenCalledOnce();

        electron.appListeners.get('before-quit')({ preventDefault: vi.fn() });
        electron.dialog.showMessageBoxSync.mockClear();
        const quitting = { preventDefault: vi.fn() };
        handlers.get('will-prevent-unload')(quitting);
        expect(electron.dialog.showMessageBoxSync).not.toHaveBeenCalled();
        expect(quitting.preventDefault).toHaveBeenCalledOnce();
    });

    it('provides context editing actions without exposing an inspect action', async () => {
        await import('../../../packages/desktop/main/index.js');
        const handlers = new Map();
        const contents = {
            session: electron.session.defaultSession,
            getURL: () => appIndex,
            setWindowOpenHandler: vi.fn(),
            on: vi.fn((name, handler) => { handlers.set(name, handler); }),
        };
        electron.appListeners.get('web-contents-created')({}, contents);

        handlers.get('context-menu')({}, {
            isEditable: true,
            selectionText: 'wallet',
            editFlags: {
                canCut: false,
                canCopy: true,
                canPaste: false,
                canSelectAll: true,
            },
        });

        expect(electron.Menu.buildFromTemplate).toHaveBeenLastCalledWith([
            { role: 'cut', enabled: false },
            { role: 'copy', enabled: true },
            { role: 'paste', enabled: false },
            { type: 'separator' },
            { role: 'selectAll', enabled: true },
        ]);
        expect(electron.popup).toHaveBeenLastCalledWith({ window: electron.ownerWindow });
        expect(electron.BrowserWindow.fromWebContents).toHaveBeenLastCalledWith(contents);

        handlers.get('context-menu')({}, {
            isEditable: false,
            selectionText: 'read-only text',
            editFlags: { canCopy: true },
        });
        expect(electron.Menu.buildFromTemplate).toHaveBeenLastCalledWith([
            { role: 'copy', enabled: true },
        ]);

        handlers.get('context-menu')({}, {
            isEditable: false,
            selectionText: '',
            editFlags: { canCopy: false },
        });
        expect(electron.Menu.buildFromTemplate).toHaveBeenCalledTimes(2);
    });

    it('creates the main BrowserWindow with every renderer security control enabled', async () => {
        const { createWindow } = await import('../../../packages/desktop/main/index.js');

        const win = createWindow();

        expect(win.options.webPreferences).toMatchObject({
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            devTools: false,
        });
    });

    it('starts at 100 percent zoom and allows pinch zoom only above it', async () => {
        const { createWindow } = await import('../../../packages/desktop/main/index.js');

        const win = createWindow();

        expect(win.options.webPreferences.zoomFactor).toBe(1);
        // A floor below 1 shows the page zoomed out, so the fixed-height shell
        // fills part of the window and the whole document scrolls.
        expect(win.webContents.setVisualZoomLevelLimits).toHaveBeenCalledExactlyOnceWith(1, 3);
    });

    it('contains a renderer load rejection and reveals a recoverable window', async () => {
        const secret = 'xchain:send?memo=private';
        electron.state.loadFileError = new Error(secret);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createWindow } = await import('../../../packages/desktop/main/index.js');

        const win = createWindow();
        await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());

        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] renderer load failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
        error.mockRestore();
    });

    it('never shows a window whose close aborted its renderer load', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createWindow } = await import('../../../packages/desktop/main/index.js');
        createWindow();
        electron.state.loadFileError = new Error('aborted by close');
        const closing = createWindow();
        const readyToShow = closing.once.mock.calls.find(([name]) => name === 'ready-to-show')[1];
        const close = closing.on.mock.calls.find(([name]) => name === 'close')[1];

        // Another window is visible, so this close goes ahead, and the load
        // it cut short reports failure while Electron tears the window down.
        const event = { preventDefault: vi.fn() };
        close(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        readyToShow();
        await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[xchain] renderer load failed'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(closing.show).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('auto-hides the menu bar on the main window except on macOS', async () => {
        const { createWindow } = await import('../../../packages/desktop/main/index.js');
        const original = Object.getOwnPropertyDescriptor(process, 'platform');
        try {
            for (const [platform, expected] of [['linux', true], ['win32', true], ['darwin', false]]) {
                Object.defineProperty(process, 'platform', { value: platform });
                expect(createWindow().options.autoHideMenuBar).toBe(expected);
            }
        } finally {
            Object.defineProperty(process, 'platform', original);
        }
    });

    it('denies every window.open, the Trezor bridge window name included', async () => {
        await import('../../../packages/desktop/main/index.js');
        let openHandler;
        const contents = {
            session: electron.session.defaultSession,
            getURL: () => appIndex,
            setWindowOpenHandler: (handler) => { openHandler = handler; },
            on: vi.fn(),
        };
        electron.appListeners.get('web-contents-created')({}, contents);
        const before = electron.browserWindowOptions.length;

        for (const [url, frameName] of [
            ['data:text/html;base64,PGh0bWw+', 'xchain-trezor-connect-bridge'],
            ['https://connect.trezor.io/9/popup.html', 'xchain-trezor-connect-bridge'],
            ['about:blank', ''],
        ]) {
            expect(openHandler({ url, frameName })).toEqual({ action: 'deny' });
        }
        expect(electron.browserWindowOptions).toHaveLength(before);
        expect(electron.session.fromPartition).not.toHaveBeenCalled();
    });

    it('builds the Trezor bridge window in main on the isolated no-HID session', async () => {
        electron.app.whenReady.mockResolvedValueOnce();
        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcHandlers.has('xchain:trezor-bridge-call')).toBe(true));
        const handler = electron.ipcHandlers.get('xchain:trezor-bridge-call');
        const before = electron.browserWindowOptions.length;

        await expect(handler({
            senderFrame: { url: 'https://connect.trezor.io/9/iframe.html' },
            sender: { getURL: () => 'https://connect.trezor.io/9/iframe.html' },
        }, { method: 'getFeatures' })).resolves.toEqual({ ok: false, error: 'trezor-bridge: rejected from untrusted frame' });
        expect(electron.browserWindowOptions).toHaveLength(before);

        const trusted = { senderFrame: { url: appIndex }, sender: { getURL: () => appIndex } };
        void handler(trusted, { method: 'getFeatures' });
        await vi.waitFor(() => expect(electron.browserWindowOptions).toHaveLength(before + 1));
        const options = electron.browserWindowOptions.at(-1);
        const win = electron.BrowserWindow.instances.at(-1);

        expect(options.webPreferences.session).toBe(electron.isolatedSession);
        expect(options.webPreferences).toMatchObject({
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools: false,
        });
        expect(options.webPreferences.preload).toMatch(/[\\/]main[\\/]trezorBridge[\\/]preload\.cjs$/);
        expect(win.loadFile).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/[\\/]main[\\/]trezorBridge[\\/]connect\.html$/));
        expect(electron.session.fromPartition).toHaveBeenCalledExactlyOnceWith('trezor-connect-isolated');
        expect(permissions.attachHidDenial).toHaveBeenCalledExactlyOnceWith(electron.isolatedSession);
        expect(permissions.attachHidPermissions).not.toHaveBeenCalledWith(electron.isolatedSession);

        const close = electron.ipcHandlers.get('xchain:trezor-bridge-close');
        await expect(close(trusted, 'extra')).resolves.toEqual({ ok: false });
        win.close = vi.fn();
        await expect(close(trusted)).resolves.toEqual({ ok: true });
        expect(win.close).toHaveBeenCalledOnce();
    });

    it('turns an IPC rejection into a logged generic response', async () => {
        const secret = 'private wallet request';
        electron.app.whenReady.mockResolvedValueOnce();
        runtime.handleIpcMessage.mockRejectedValueOnce(new Error(secret));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.ipcMain.handle).toHaveBeenCalled());
        const handler = electron.ipcMain.handle.mock.calls
            .find(([channel]) => channel === 'xchain-wallet:message')[1];
        const result = await handler({
            senderFrame: { url: appIndex },
            sender: { getURL: () => appIndex },
        }, { type: 'wallet.test' });

        expect(result).toEqual({
            ok: false,
            error: { name: 'Error', message: 'desktop: message handling failed' },
        });
        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] wallet IPC message failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
        error.mockRestore();
    });
});

describe('desktop window bounds on close and quit', () => {
    const STALE = { x: 80, y: 60, width: 1180, height: 820 };
    const MOVED = { x: 300, y: 200, width: 1300, height: 900 };

    async function bootWithSavedBounds() {
        const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-main-bounds-'));
        tempDirs.push(userDataDir);
        const boundsPath = join(userDataDir, 'window-bounds.json');
        writeFileSync(boundsPath, JSON.stringify(STALE));
        electron.state.userDataDir = userDataDir;
        electron.app.whenReady.mockResolvedValueOnce();

        await import('../../../packages/desktop/main/index.js');
        await vi.waitFor(() => expect(electron.BrowserWindow.instances).toHaveLength(1));
        const win = electron.BrowserWindow.instances[0];
        const handler = (name) => win.on.mock.calls.find(([event]) => event === name)[1];
        const onDisk = () => JSON.parse(readFileSync(boundsPath, 'utf8'));
        return { win, handler, onDisk };
    }

    it.each([
        ['normal', null],
        ['minimized', 'isMinimized'],
        ['maximized', 'isMaximized'],
    ])('writes normal bounds before a %s window close returns', async (_state, stateMethod) => {
        const { win, handler, onDisk } = await bootWithSavedBounds();
        electron.state.normalBounds = MOVED;
        if (stateMethod) win[stateMethod] = vi.fn(() => true);

        handler('close')({ preventDefault: vi.fn() });

        // No await between the handler and the read: the write has landed.
        expect(onDisk()).toEqual(MOVED);
    });

    it('writes pending bounds before the before-quit handler returns', async () => {
        const { handler, onDisk } = await bootWithSavedBounds();
        electron.state.normalBounds = MOVED;
        handler('resize')();
        expect(onDisk()).toEqual(STALE);

        electron.appListeners.get('before-quit')();

        expect(onDisk()).toEqual(MOVED);
    });

    it('keeps moves and resizes on the debounced async save', async () => {
        const { handler, onDisk } = await bootWithSavedBounds();
        const syncWrite = fsControl.writeFileSync;
        syncWrite.mockClear();
        electron.state.normalBounds = MOVED;

        handler('move')();
        handler('resize')();

        expect(onDisk()).toEqual(STALE);
        await vi.waitFor(() => expect(onDisk()).toEqual(MOVED), { timeout: 2000 });
        expect(syncWrite).not.toHaveBeenCalled();
    });

    it('logs and carries on when the quit-time write fails', async () => {
        const { handler } = await bootWithSavedBounds();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const syncWrite = fsControl.writeFileSync;
        syncWrite.mockClear();
        fsControl.failSyncWrite = true;
        electron.state.normalBounds = MOVED;

        expect(() => handler('close')({ preventDefault: vi.fn() })).not.toThrow();
        expect(() => electron.appListeners.get('before-quit')()).not.toThrow();
        expect(syncWrite).toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith('[xchain] desktop window bounds save failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain('disk full');
        error.mockRestore();
    });
});

function submenu(template, label) {
    return template.find((item) => item.label === label)?.submenu ?? [];
}

function actionableLeaves(template) {
    return template.flatMap((item) => item.submenu ?? [])
        .filter((item) => item.type !== 'separator');
}

describe('desktop application menu', () => {
    it.each([
        ['darwin', '&File', 'close'],
        ['win32', '&File', 'quit'],
        ['linux', '&File', 'quit'],
    ])('uses native %s lifecycle roles', async (platform, fileLabel, finalRole) => {
        const { installApplicationMenu } = await import('../../../packages/desktop/main/index.js');
        electron.app.isPackaged = true;
        installApplicationMenu({ isMac: platform === 'darwin' });
        const template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        const file = submenu(template, fileLabel);

        expect(file.at(-1)).toEqual({ role: finalRole });
        expect(submenu(template, '&View').find((item) => item.label === 'Reload')).toMatchObject({
            accelerator: 'CmdOrCtrl+R',
            click: expect.any(Function),
        });
        expect(actionableLeaves(template).every((item) => item.role || item.click)).toBe(true);
    });

    it('provides native editing commands and only platform-valid window commands', async () => {
        const { installApplicationMenu } = await import('../../../packages/desktop/main/index.js');

        installApplicationMenu({ isMac: false });
        let template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        expect(submenu(template, '&Edit').map((item) => item.role).filter(Boolean)).toEqual([
            'undo',
            'redo',
            'cut',
            'copy',
            'paste',
            'selectAll',
        ]);
        expect(submenu(template, '&Window').map((item) => item.role).filter(Boolean)).toEqual([
            'minimize',
            'close',
        ]);

        installApplicationMenu({ isMac: true });
        template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        expect(submenu(template, '&Window').map((item) => item.role).filter(Boolean)).toEqual([
            'minimize',
            'zoom',
            'front',
        ]);
    });

    it('reloads renderer contents without clearing the unlocked main-process session', async () => {
        const { createWindow, installApplicationMenu } = await import(
            '../../../packages/desktop/main/index.js'
        );
        const win = createWindow();
        installApplicationMenu({ isMac: false });
        const template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        const view = submenu(template, '&View');
        const reload = view.find((item) => item.label === 'Reload');
        const forceReload = view.find((item) => item.label === 'Force Reload');

        reload.click({}, win);
        forceReload.click({}, win);

        expect(reload.accelerator).toBe('CmdOrCtrl+R');
        expect(forceReload.accelerator).toBe('CmdOrCtrl+Shift+R');
        expect(win.webContents.reload).toHaveBeenCalledOnce();
        expect(win.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
        expect(runtime.tearDownHost).not.toHaveBeenCalled();
        expect(runtime.instance.sessionBackend.clear).not.toHaveBeenCalled();
    });

    it('places About in the native macOS app menu and invokes it from Help elsewhere', async () => {
        const { installApplicationMenu } = await import('../../../packages/desktop/main/index.js');

        electron.app.isPackaged = true;
        installApplicationMenu({ isMac: true });
        let template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        expect(template[0].submenu[0]).toEqual({ role: 'about' });
        expect(template.some((item) => item.label === '&Help')).toBe(false);

        installApplicationMenu({ isMac: false });
        template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        const about = submenu(template, '&Help').find((item) => item.label?.startsWith('About '));
        about.click();
        expect(electron.app.showAboutPanel).toHaveBeenCalledOnce();
    });

    it('keeps developer tools out of packaged menus and gives custom commands unique accelerators', async () => {
        const { installApplicationMenu } = await import('../../../packages/desktop/main/index.js');

        electron.app.isPackaged = true;
        installApplicationMenu({ isMac: false });
        let template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        expect(actionableLeaves(template).some((item) => item.role === 'toggleDevTools')).toBe(false);

        electron.app.isPackaged = false;
        installApplicationMenu({ isMac: false });
        template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
        expect(actionableLeaves(template).some((item) => item.role === 'toggleDevTools')).toBe(true);
        const roles = actionableLeaves(template).map((item) => item.role).filter(Boolean);
        expect(new Set(roles).size).toBe(roles.length);
        const accelerators = actionableLeaves(template)
            .map((item) => item.accelerator)
            .filter(Boolean)
            .map((accelerator) => accelerator.toLowerCase());
        expect(new Set(accelerators).size).toBe(accelerators.length);
        expect(accelerators).toEqual([
            'cmdorctrl+shift+n',
            'cmdorctrl+r',
            'cmdorctrl+shift+r',
        ]);
    });

    it('provides native zoom shortcuts including reset to 100 percent', async () => {
        const { installApplicationMenu } = await import('../../../packages/desktop/main/index.js');

        installApplicationMenu({ isMac: false });
        const template = electron.Menu.buildFromTemplate.mock.calls.at(-1)[0];

        // Reload and Force Reload are labelled commands, not roles.
        expect(submenu(template, '&View').map((item) => item.role).filter(Boolean)).toEqual([
            'resetZoom',
            'zoomIn',
            'zoomOut',
            'togglefullscreen',
        ]);
    });
});

describe('desktop main-process failure boundaries', () => {
    it('logs one context-only record for a repeated error and resolves the task', async () => {
        const {
            reportMainFailure,
            runMainCallback,
            runMainTask,
        } = await import('../../../packages/desktop/main/errorBoundary.js');
        const secret = 'bitcoin:bc1qsecret?amount=4';
        const failure = new Error(secret);
        const log = vi.fn();

        expect(runMainCallback(() => { throw failure; }, 'protocol callback', log)).toBeUndefined();
        await expect(runMainTask(() => Promise.reject(failure), 'protocol callback', { log }))
            .resolves.toBeUndefined();
        expect(reportMainFailure('protocol callback', failure, log)).toBe(false);

        expect(log).toHaveBeenCalledExactlyOnceWith('[xchain] protocol callback failed');
        expect(log.mock.calls.flat().join(' ')).not.toContain(secret);
    });

    it('installs idempotent process-level rejection and exception handlers', async () => {
        const { installProcessErrorHandlers } = await import(
            '../../../packages/desktop/main/errorBoundary.js'
        );
        const listeners = new Map();
        const proc = {
            on: vi.fn((name, handler) => { listeners.set(name, handler); }),
            off: vi.fn((name) => { listeners.delete(name); }),
        };
        const log = vi.fn();

        const dispose = installProcessErrorHandlers(proc, log);
        expect(installProcessErrorHandlers(proc, log)).toBe(dispose);
        listeners.get('unhandledRejection')(new Error('private rejection text'));
        listeners.get('uncaughtException')(new Error('private exception text'));

        expect(log.mock.calls).toEqual([
            ['[xchain] unhandled main-process rejection failed'],
            ['[xchain] uncaught main-process exception failed'],
        ]);
        expect(proc.on).toHaveBeenCalledTimes(2);
        dispose();
        expect(proc.off).toHaveBeenCalledTimes(2);
    });

    it('contains deep-link callback exceptions and reports them once', async () => {
        const { attachDeepLinkHandlers } = await vi.importActual(
            '../../../packages/desktop/main/protocol.js',
        );
        const app = (() => {
            const listeners = new Map();
            return {
                listeners,
                requestSingleInstanceLock: () => true,
                on: (name, handler) => { listeners.set(name, handler); },
            };
        })();
        const failure = new Error('xchain:private?memo=secret');
        const onError = vi.fn();
        attachDeepLinkHandlers(app, {
            onDeepLink: () => { throw failure; },
            onError,
        });

        expect(() => app.listeners.get('open-url')(
            { preventDefault: vi.fn() },
            'xchain:BTC/send?to=address',
        )).not.toThrow();
        expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    });

    it('contains updater event consumer exceptions without disabling updater events', async () => {
        const { attachUpdater } = await vi.importActual(
            '../../../packages/desktop/main/updater.js',
        );
        const listeners = new Map();
        const autoUpdater = {
            isUpdaterActive: () => true,
            on: (name, handler) => { listeners.set(name, handler); },
            checkForUpdates: vi.fn(async () => {}),
            downloadUpdate: vi.fn(async () => []),
            quitAndInstall: vi.fn(),
        };
        const failure = new Error('private updater listener text');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await attachUpdater({
            loader: async () => ({ autoUpdater }),
            onEvent: () => { throw failure; },
            feedBaseUrl: 'https://feed.invalid/wallet/',
        });

        expect(() => listeners.get('checking-for-update')()).not.toThrow();
        expect(() => listeners.get('update-available')({ version: '2.0.0' })).not.toThrow();
        expect(error).toHaveBeenCalledExactlyOnceWith('[xchain] updater event delivery failed');
        expect(error.mock.calls.flat().join(' ')).not.toContain(failure.message);
        error.mockRestore();
    });
});
