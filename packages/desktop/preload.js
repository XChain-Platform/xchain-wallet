// Electron preload — the single bridge between renderer and main.
//
// §9.3.2: "keys never cross the contextBridge IPC boundary into the
// renderer." This preload upholds that by exposing exactly two narrow
// APIs via contextBridge. Nothing about Node, the filesystem, Electron
// internals, or native modules is exposed to the renderer.
//
//   - `xchainWalletBridge.sendMessage(message)` — request/response for
//     every MessageHost call (unlock, sendAsset, etc.). Mirrors the
//     extension popup + web shell wire format.
//
//   - `xchainWalletSignerBridge.{postMessage,onMessage,onDisconnect}`
//     — duplex port for the hardware-signer RPC. Renderer-hosted
//     Trezor/Ledger signers expose their status + sign methods back
//     to the main process over this channel. Shaped as a neutral
//     {postMessage, onMessage} adapter so the desktop renderer +
//     main reuse the same `signerPortProtocol` helpers the extension
//     uses over `chrome.runtime.connect` ports.

import { contextBridge, ipcRenderer } from 'electron';

const MESSAGE_CHANNEL = 'xchain-wallet:message';
const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';

contextBridge.exposeInMainWorld('xchainWalletBridge', {
    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }>}
     */
    sendMessage(message) {
        return ipcRenderer.invoke(MESSAGE_CHANNEL, message);
    },
});

contextBridge.exposeInMainWorld('xchainWalletSignerBridge', {
    /**
     * Renderer → main. Fire-and-forget; the reply (when one is
     * warranted) arrives on the `onMessage` stream.
     * @param {any} msg
     */
    postMessage(msg) {
        ipcRenderer.send(SIGNER_BRIDGE_CHANNEL, msg);
    },
    /**
     * Subscribe to main → renderer messages. Returns an unsubscribe.
     * @param {(msg: any) => void} listener
     * @returns {() => void}
     */
    onMessage(listener) {
        const wrapped = (_event, msg) => { listener(msg); };
        ipcRenderer.on(SIGNER_BRIDGE_CHANNEL, wrapped);
        return () => ipcRenderer.removeListener(SIGNER_BRIDGE_CHANNEL, wrapped);
    },
});
