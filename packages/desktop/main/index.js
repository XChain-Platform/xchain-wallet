// Electron main process — entry point.
//
// Thin adapter over `runtime.js`: wires Electron's lifecycle events to
// the pure-JS runtime state machine. Keeping Electron-specific code
// confined to this file means the IPC dispatch + auto-unlock logic is
// testable under plain Node (see `desktop-keychain.smoke.js`).
//
// Security posture (§9.3.2):
//   - Renderer runs with nodeIntegration=false, contextIsolation=true.
//   - Preload is the only bridge; it exposes a single
//     `sendMessage(message)` function via contextBridge.
//   - Vault + signers live in main; the master key never crosses IPC.
//   - All IPC traffic returns structured `{ ok, result } | { ok, error }`
//     envelopes — same shape the extension background uses, so shared
//     renderer code doesn't need to branch on shell.
//
// OS keychain integration (§40.12, Step 17):
//   - After first-launch unlock, the master key is cached in the OS
//     keychain via Electron `safeStorage` (macOS Keychain / Windows DPAPI
//     / Linux libsecret). The ciphertext is written to `session.bin`;
//     the key material stays inside the OS keychain.
//   - On subsequent launches, `app.whenReady` probes the keychain; if
//     the master key is readable, the vault opens and the renderer's
//     first `session.status` call returns `unlocked` — the password
//     prompt is skipped until the user explicitly locks (or the keychain
//     becomes unreadable, e.g. OS logout, keychain reset).
//   - If `safeStorage.isEncryptionAvailable()` is false, the session
//     cache is silently disabled — the user re-enters their password
//     every launch rather than having the key written insecurely.

import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry as registryLib, sdk as sdkLib } from '@xchain-wallet/core';
import { createDevMockSdk } from '@xchain-wallet/extension/src/background/sdkFactory.js';

import { IPC_CHANNEL } from './messageHost.js';
// Pre-host + runtime helpers live in the pure-JS runtime module so the
// IPC dispatch logic is testable without importing `electron`.
import { FileStorageBackend, vaultPathFor } from './storage.js';
import { FileMetaBackend, metaPathFor } from './meta.js';
import { KeychainSessionBackend, sessionKeyPathFor } from './keychain.js';
import {
    createRuntime,
    ensureHost,
    handleIpcMessage,
    tearDownHost,
} from './runtime.js';

const here = dirname(fileURLToPath(import.meta.url));

let mainWindow = /** @type {BrowserWindow | null} */ (null);
let runtime = /** @type {ReturnType<typeof createRuntime> | null} */ (null);

function buildRuntime() {
    const userData = app.getPath('userData');
    const chainRegistry = registryLib.defaultRegistry();
    return createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userData)),
        metaBackend: new FileMetaBackend(metaPathFor(userData)),
        sessionBackend: new KeychainSessionBackend({
            safeStorage,
            filePath: sessionKeyPathFor(userData),
        }),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: createDevMockSdk,
        }),
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 420,
        height: 720,
        minWidth: 360,
        minHeight: 600,
        webPreferences: {
            preload: join(here, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        show: false,
    });

    // Renderer is built into packages/desktop/renderer/dist by Step 19's
    // packaging pipeline. In dev we load the file directly.
    mainWindow.loadFile(join(here, '..', 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    runtime = buildRuntime();
    // Best-effort auto-unlock. Failure here is logged but doesn't block
    // startup — the renderer will see `state: 'locked'` and prompt for
    // the password.
    try {
        await ensureHost(runtime);
    } catch (err) {
        console.error('[xchain] desktop auto-unlock failed:', err);
    }

    ipcMain.handle(IPC_CHANNEL, async (_event, message) => {
        if (!runtime) {
            return {
                ok: false,
                error: { name: 'Error', message: 'desktop: runtime not initialized' },
            };
        }
        return handleIpcMessage(runtime, message);
    });

    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Zero the master key + close the encrypted doc. The OS already
    // treats process-exit memory as freed, but explicit zeroing catches
    // cases where a GC'd buffer might otherwise linger until
    // reallocation. The session-backend ciphertext stays on disk — the
    // next launch reuses it via the keychain.
    if (runtime) tearDownHost(runtime);
});
