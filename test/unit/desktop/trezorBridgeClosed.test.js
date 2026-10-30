// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop Trezor Connect bridge is a separate window the user can close.
// Main settles a call the closed window cannot answer as a retryable
// disconnect, and the renderer surfaces that refusal unchanged, so the
// confirm screen offers a retry and the next call goes to a fresh window.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xchain-wallet/core/signerFactories', () => ({
    makeTrezorFactory: vi.fn(),
}));

const {
    getTrezorConnect,
    resetTrezorConnect,
} = await import('../../../packages/desktop/renderer/signerFactories/trezorFactory.js');

// The pattern useConfirmAction reads as "reconnect and Approve again".
const RETRYABLE_DISCONNECT = /transport.*(?:disconnected|unavailable|missing)/i;
// main/trezorBridgeWindow.js BRIDGE_CLOSED_MESSAGE, as main's relay answers it.
const CLOSED = 'desktop trezorFactory: the Trezor Connect transport disconnected because its '
    + 'window closed before the device answered. Nothing was broadcast.';

function installRelay(call) {
    const world = { call: vi.fn(call), close: vi.fn(async () => ({ ok: true })) };
    window.xchainWalletTrezorBridge = world;
    return world;
}

beforeEach(() => resetTrezorConnect());
afterEach(() => {
    resetTrezorConnect();
    delete window.xchainWalletTrezorBridge;
    vi.restoreAllMocks();
});

describe('desktop Trezor bridge window closed', () => {
    it('settles a sign in flight as a retryable disconnect when main reports the bridge closed', async () => {
        installRelay(async () => ({ ok: false, error: CLOSED }));
        const proxy = await getTrezorConnect();

        const err = await proxy.signTransaction({ inputs: [] }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(RETRYABLE_DISCONNECT);
        expect(err.message).toMatch(/Nothing was broadcast/);
    });

    it('sends the next call through the relay again after a close', async () => {
        const relay = installRelay(async () => ({ ok: false, error: CLOSED }));
        const proxy = await getTrezorConnect();
        await expect(proxy.getFeatures()).rejects.toThrow(RETRYABLE_DISCONNECT);

        relay.call.mockImplementation(async () => ({ ok: true, result: { success: true, payload: { device_id: 'd1' } } }));
        await expect(proxy.getFeatures()).resolves.toEqual({ success: true, payload: { device_id: 'd1' } });
        expect(relay.call.mock.calls.map(([method]) => method)).toEqual(['getFeatures', 'getFeatures']);
    });

    it('opens no window of its own and posts no message', async () => {
        const open = vi.spyOn(window, 'open');
        const post = vi.spyOn(window, 'postMessage');
        installRelay(async () => ({ ok: true, result: { success: true } }));
        const proxy = await getTrezorConnect();
        await proxy.getFeatures();
        expect(open).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('asks main to close the bridge on reset', async () => {
        const relay = installRelay(async () => ({ ok: true, result: undefined }));
        await getTrezorConnect();
        resetTrezorConnect();
        await vi.waitFor(() => expect(relay.close).toHaveBeenCalledOnce());
        expect(relay.close).toHaveBeenCalledWith();
    });
});
