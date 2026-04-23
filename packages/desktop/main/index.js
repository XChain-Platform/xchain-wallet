// Electron main process — entry point.
//
// Lifecycle:
//   app.whenReady()                  → initialize vault + host + window
//   ipcMain.handle(IPC_CHANNEL)      → route messages into MessageHost
//   app.on('window-all-closed')      → quit on non-darwin; hide on macOS
//   app.on('before-quit')            → close vault (zero master key)
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
// The OS keychain integration (§17 Step 17) will hook into `app.whenReady`
// to prompt for the first-launch password once per boot and cache the
// master key via Electron `safeStorage`. For Step 16 the vault stays
// locked until the renderer's unlock screen collects the password —
// same as the extension's and web app's first-run flow.

import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    registry as registryLib,
    storage as storageLib,
} from '@xchain-wallet/core';
import { createDesktopMessageHost, IPC_CHANNEL } from './messageHost.js';
import { FileStorageBackend, vaultPathFor } from './storage.js';

const here = dirname(fileURLToPath(import.meta.url));

let mainWindow = /** @type {BrowserWindow | null} */ (null);
let vault = /** @type {import('@xchain-wallet/core').storage.Vault | null} */ (null);

async function initMain() {
    const chainRegistry = registryLib.defaultRegistry();
    // SDK resolution follows the same pattern as the extension's
    // sdkFactory — Step 16 ships the scaffold with a dev-mock SDK
    // placeholder. The real `xchain-sdk` factory lands alongside the
    // signing-integration step (see v0.53.0 CHANGELOG "Known
    // deferrals").
    const sdkRegistry = createDevSdkRegistryStub();

    const backend = new FileStorageBackend(vaultPathFor(app.getPath('userData')));
    // Defer vault.open until the user unlocks via the renderer. The
    // renderer's `wallet.unlock` handler opens and seeds the host
    // dependencies at that point. Step 17 will add safeStorage-
    // backed auto-unlock to skip the first prompt on subsequent
    // launches.
    const masterKey = new Uint8Array(32);  // placeholder; replaced on unlock
    vault = new storageLib.Vault({ backend, masterKey });

    const { handle } = createDesktopMessageHost({
        vault, chainRegistry, sdkRegistry,
    });

    ipcMain.handle(IPC_CHANNEL, async (_event, message) => handle(message));
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
    await initMain();
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Zero the master key + close the encrypted doc. Defence in depth —
    // the OS already treats process-exit memory as freed, but explicit
    // zeroing catches cases where a GC'd buffer might otherwise linger
    // until reallocation.
    if (vault && typeof vault.close === 'function') {
        try { vault.close(); } catch { /* already closed */ }
    }
});

/**
 * Placeholder SDK registry for the Step 16 scaffold. Mirrors the
 * extension's dev-mock posture (see
 * `packages/extension/src/background/sdkFactory.js`): good enough to
 * let the onboarding + read flows exercise; signing + broadcast
 * throw loudly. Real `xchain-sdk` wiring lands with the signing
 * integration step.
 */
function createDevSdkRegistryStub() {
    return {
        async getSdk() {
            throw new Error(
                'desktop: xchain-sdk is not yet wired — run the pnpm install and bundle step before signing/broadcast paths exercise.',
            );
        },
        async has() { return false; },
        async listChainIds() { return []; },
    };
}
