// Electron preload — the single bridge between renderer and main.
//
// §9.3.2: "keys never cross the contextBridge IPC boundary into the
// renderer." This preload upholds that by exposing exactly one
// function — `sendMessage(message)` — which invokes the main-process
// IPC handler and returns the structured response envelope. Nothing
// about Node, the filesystem, Electron internals, or native modules
// is exposed to the renderer.
//
// The renderer imports a messaging module that wraps
// `window.xchainWalletBridge.sendMessage(…)` into popup/web-parity
// helpers (unlockWallet, sendAsset, etc.) — same signatures the
// extension popup and web shell expose, so
// `@xchain-wallet/core/shared/routes/*` components render unchanged.

import { contextBridge, ipcRenderer } from 'electron';

const IPC_CHANNEL = 'xchain-wallet:message';

contextBridge.exposeInMainWorld('xchainWalletBridge', {
    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }>}
     */
    sendMessage(message) {
        return ipcRenderer.invoke(IPC_CHANNEL, message);
    },
});
