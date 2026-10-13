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
    const browserWindowOptions = [];
    const isolatedSession = { partition: 'trezor-connect-isolated' };
    const state = {
        userDataDir: '/tmp/xchain-main-entry-test',
        displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        normalBounds: { x: 0, y: 0, width: 1024, height: 768 },
    };
    const ownerWindow = {};
    const popup = vi.fn();
    class BrowserWindow {
        static instances = [];
        static fromWebContents = vi.fn(() => ownerWindow);

        constructor(options) {
            browserWindowOptions.push(options);
            this.options = options;
            this.webContents = { send: vi.fn() };
            this.loadFile = vi.fn();
            this.once = vi.fn();
            this.on = vi.fn();
            this.isDestroyed = vi.fn(() => false);
            this.isVisible = vi.fn(() => true);
            this.hide = vi.fn();
            this.getNormalBounds = vi.fn(() => state.normalBounds);
            BrowserWindow.instances.push(this);
        }

        static getAllWindows() {
            return BrowserWindow.instances;
        }

        static getFocusedWindow() { return null; }
    }
    return {
        appListeners,
        browserWindowOptions,
        isolatedSession,
        ownerWindow,
        popup,
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
        Menu: {
            buildFromTemplate: vi.fn(() => ({ popup })),
            setApplicationMenu: vi.fn(),
        },
        ipcMain: { handle: vi.fn() },
        safeStorage: {},
        screen: {
            getAllDisplays: vi.fn(() => state.displays),
            getPrimaryDisplay: vi.fn(() => state.displays[0]),
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
    ensureHost: vi.fn(),
    handleIpcMessage: vi.fn(),
    tearDownHost: vi.fn(),
    wipeRuntimeStores: vi.fn(),
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
    electron.state.displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    electron.state.normalBounds = { x: 0, y: 0, width: 1024, height: 768 };
    fsControl.failSyncWrite = false;
    electron.BrowserWindow.instances.length = 0;
    electron.app.isPackaged = true;
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
        expect(protocol.attachDeepLinkHandlers.mock.calls[0][1].onSecondInstance).toBeTypeOf('function');
        expect(electron.app.whenReady).toHaveBeenCalledOnce();
        expect(electron.app.quit).not.toHaveBeenCalled();
    });

    it('quits when another Electron instance owns the application lock', async () => {
        protocol.attachDeepLinkHandlers.mockReturnValue({ gotLock: false });

        await import('../../../packages/desktop/main/index.js');

        expect(electron.app.quit).toHaveBeenCalledOnce();
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

    it('keeps an origin inside either display instead of clamping to the larger overlap', async () => {
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

        expect(electron.browserWindowOptions[0]).toMatchObject(savedBounds);
    });

    it('hides on macOS close, permits an explicit quit, and reveals hidden windows', async () => {
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

        expect(applyWindowCloseConvention(win, event, { platform: 'darwin', quitting: false })).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(win.hide).toHaveBeenCalledOnce();

        event.preventDefault.mockClear();
        win.hide.mockClear();
        expect(applyWindowCloseConvention(win, event, { platform: 'darwin', quitting: true })).toBe(false);
        expect(applyWindowCloseConvention(win, event, { platform: 'win32', quitting: false })).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(win.hide).not.toHaveBeenCalled();

        expect(revealWindow(win)).toBe(true);
        expect(win.restore).toHaveBeenCalledOnce();
        expect(win.show).toHaveBeenCalledOnce();
        expect(win.focus).toHaveBeenCalledOnce();
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
        });
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
            webSecurity: true,
            devTools: false,
        });
        expect(result.overrideBrowserWindowOptions.webPreferences).not.toHaveProperty('preload');
        expect(electron.session.fromPartition).toHaveBeenCalledExactlyOnceWith('trezor-connect-isolated');
        expect(permissions.attachHidDenial).toHaveBeenCalledExactlyOnceWith(electron.isolatedSession);
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

    it('writes the latest bounds before the close handler returns', async () => {
        const { handler, onDisk } = await bootWithSavedBounds();
        electron.state.normalBounds = MOVED;

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
        expect(error).toHaveBeenCalledWith(
            '[xchain] could not save desktop window bounds:',
            expect.objectContaining({ message: 'disk full' }),
        );
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
        expect(submenu(template, '&View').map((item) => item.role).filter(Boolean)).toContain('reload');
        expect(actionableLeaves(template).every((item) => item.role || item.click)).toBe(true);
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
        expect(accelerators).toEqual(['cmdorctrl+n']);
    });
});
