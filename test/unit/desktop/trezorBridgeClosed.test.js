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
// A call a closed bridge cannot answer settles as a retryable disconnect, and the
// next call opens a fresh bridge instead of failing until the app restarts.

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

function emitMessage(source, data) {
    const event = new Event('message');
    Object.defineProperties(event, { source: { value: source }, data: { value: data } });
    window.dispatchEvent(event);
}

function makeBridgeWindow() {
    return { closed: false, postMessage: vi.fn(), close: vi.fn() };
}

// Answers ready and init for a bridge window the factory has just opened.
async function bringUp(win) {
    await vi.waitFor(() => expect(window.open).toHaveBeenCalled());
    emitMessage(win, { type: 'xchain-trezor-bridge-ready' });
    await vi.waitFor(() => expect(win.postMessage).toHaveBeenCalledOnce());
    const init = win.postMessage.mock.calls[0][0];
    expect(init.method).toBe('init');
    emitMessage(win, { id: init.id, ok: true, result: undefined });
}

beforeEach(() => resetTrezorConnect());
afterEach(() => {
    resetTrezorConnect();
    vi.restoreAllMocks();
});

describe('desktop Trezor bridge window closed', () => {
    it('settles a sign in flight as a retryable disconnect when the bridge closes', async () => {
        const win = makeBridgeWindow();
        vi.spyOn(window, 'open').mockReturnValue(win);
        const connecting = getTrezorConnect();
        await bringUp(win);
        const proxy = await connecting;

        const sign = proxy.signTransaction({ inputs: [] });
        const settled = sign.then(() => 'resolved', (err) => err);
        await vi.waitFor(() => expect(win.postMessage).toHaveBeenCalledTimes(2));
        win.closed = true;

        const err = await vi.waitFor(async () => {
            const value = await Promise.race([settled, Promise.resolve('pending')]);
            if (value === 'pending') throw new Error('still pending');
            return value;
        }, { timeout: 3000, interval: 50 });
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(RETRYABLE_DISCONNECT);
        expect(err.message).toMatch(/Nothing was broadcast/);
    });

    it('opens a fresh bridge for the next call after the window closed', async () => {
        const first = makeBridgeWindow();
        const second = makeBridgeWindow();
        vi.spyOn(window, 'open').mockReturnValueOnce(first).mockReturnValueOnce(second);
        const connecting = getTrezorConnect();
        await bringUp(first);
        const proxy = await connecting;
        first.closed = true;

        const features = proxy.getFeatures();
        await vi.waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
        await bringUp(second);
        await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalledTimes(2));
        const call = second.postMessage.mock.calls[1][0];
        expect(call.method).toBe('getFeatures');
        emitMessage(second, { id: call.id, ok: true, result: { success: true, payload: { device_id: 'd1' } } });
        await expect(features).resolves.toEqual({ success: true, payload: { device_id: 'd1' } });
        expect(first.postMessage).toHaveBeenCalledOnce();
    });

    it('retries a failed init on the next connect instead of caching the failure', async () => {
        const first = makeBridgeWindow();
        const second = makeBridgeWindow();
        vi.spyOn(window, 'open').mockReturnValueOnce(first).mockReturnValueOnce(second);
        const failing = getTrezorConnect();
        emitMessage(first, { type: 'xchain-trezor-bridge-ready' });
        await vi.waitFor(() => expect(first.postMessage).toHaveBeenCalledOnce());
        emitMessage(first, { id: first.postMessage.mock.calls[0][0].id, ok: false, error: 'Init failed' });
        await expect(failing).rejects.toThrow('Init failed');
        expect(first.close).toHaveBeenCalled();

        const retry = getTrezorConnect();
        await bringUp(second);
        await expect(retry).resolves.toBeTruthy();
    });

    it('ignores a reply that arrives from a closed bridge after the call settled', async () => {
        const first = makeBridgeWindow();
        const second = makeBridgeWindow();
        vi.spyOn(window, 'open').mockReturnValueOnce(first).mockReturnValueOnce(second);
        const connecting = getTrezorConnect();
        await bringUp(first);
        const proxy = await connecting;
        const sign = proxy.signTransaction({ inputs: [] });
        await vi.waitFor(() => expect(first.postMessage).toHaveBeenCalledTimes(2));
        const staleId = first.postMessage.mock.calls[1][0].id;
        first.closed = true;
        await expect(sign).rejects.toThrow(RETRYABLE_DISCONNECT);

        const retry = proxy.signTransaction({ inputs: [] });
        await bringUp(second);
        await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalledTimes(2));
        emitMessage(first, { id: staleId, ok: true, result: { success: true, payload: { serializedTx: 'stale' } } });
        emitMessage(second, { id: staleId, ok: true, result: { success: true, payload: { serializedTx: 'stale' } } });
        const live = second.postMessage.mock.calls[1][0];
        expect(live.id).not.toBe(staleId);
        emitMessage(second, { id: live.id, ok: true, result: { success: true, payload: { serializedTx: 'fresh' } } });
        await expect(retry).resolves.toEqual({ success: true, payload: { serializedTx: 'fresh' } });
    });
});
