// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop main-process MessageHost.
//
// §9.3.2: main owns the Vault, the SDK instance, and all signers;
// keys never cross the contextBridge IPC boundary into the renderer.
// This module wires the shared `createBackgroundHost` factory (same
// one the extension service worker uses) against a desktop-specific
// dependency set (file-backed vault, `xchain-sdk` running in the
// Node runtime rather than a service-worker polyfill).
//
// Renderer talks to main via the preload-exposed `sendMessage`;
// every call lands here and returns a `{ ok, result } | { ok, error }`
// envelope, matching the extension shell's wire format so shared
// `core/shared/routes/*` components work unchanged.

import { createBackgroundHost } from '../../extension/src/background/createBackgroundHost.js';

/**
 * @typedef {Object} DesktopHostDeps
 * @property {import('@xchain-wallet/core').storage.Vault} vault
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {import('@xchain-wallet/extension/src/bridge/Approvals.js').Approvals} [approvals]
 *
 * @typedef {{ type: string, request?: unknown }} IpcMessage
 * @typedef {{ ok: true, result: unknown } | { ok: false, error: { name: string, message: string } }} IpcResponse
 */

/**
 * Build the main-process MessageHost. Returns the host plus a
 * `handle(message)` wrapper that IPC registration calls directly:
 *
 *     const { host, handle } = createDesktopMessageHost({ vault, … });
 *     ipcMain.handle('xchain-wallet:message', (_event, message) => handle(message));
 *
 * @param {DesktopHostDeps} deps
 * @returns {{ host: import('@xchain-wallet/extension/src/background/MessageHost.js').MessageHost, handle: (message: IpcMessage) => Promise<IpcResponse> }}
 */
export function createDesktopMessageHost(deps) {
    if (!deps?.vault) throw new Error('createDesktopMessageHost: vault is required');
    if (!deps?.chainRegistry) throw new Error('createDesktopMessageHost: chainRegistry is required');
    if (!deps?.sdkRegistry) throw new Error('createDesktopMessageHost: sdkRegistry is required');
    const host = createBackgroundHost(deps);
    return {
        host,
        async handle(message) {
            return host.handle(message);
        },
    };
}

/**
 * IPC channel name. Single string constant so preload + main agree
 * and renderers never hand-write the channel. Prefixed with
 * `xchain-wallet:` so an accidental message from another library
 * surfaces as an UnknownMessageTypeError instead of silently reaching
 * our handler.
 */
export const IPC_CHANNEL = 'xchain-wallet:message';
