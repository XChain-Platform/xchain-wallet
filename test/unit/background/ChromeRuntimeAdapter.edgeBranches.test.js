// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TRUSTED = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
const WEB = {
    id: EXT_ID,
    origin: 'https://app.example',
    url: 'https://app.example/',
    tab: { id: 41 },
};

function runtimeBus() {
    let listener;
    return {
        id: EXT_ID,
        onMessage: {
            addListener: vi.fn((next) => { listener = next; }),
            removeListener: vi.fn(),
        },
        emit(message, sender = TRUSTED) {
            return new Promise((resolve) => {
                const handled = listener(message, sender, resolve);
                if (!handled) resolve(undefined);
            });
        },
    };
}

describe('ChromeRuntimeAdapter edge branches', () => {
    it('rejects a runtime without an onMessage surface', () => {
        expect(() => attachChromeRuntime({ handle: vi.fn() }, {})).toThrow(
            'chrome.runtime.onMessage is not available',
        );
    });

    it('tells the activity hook which message type a trusted page sent', async () => {
        const runtime = runtimeBus();
        const onActivity = vi.fn(() => undefined);
        attachChromeRuntime({ handle: vi.fn(async () => ({ ok: true, result: null })) }, runtime, { onActivity });

        await runtime.emit({ type: 'balances.wallet' });

        expect(onActivity).toHaveBeenCalledWith('balances.wallet');
    });

    it('declines pre-host messages without calling the host', async () => {
        const runtime = runtimeBus();
        const host = { handle: vi.fn() };
        attachChromeRuntime(host, runtime);

        await expect(runtime.emit({ type: 'session.status' })).resolves.toBeUndefined();
        expect(host.handle).not.toHaveBeenCalled();
    });

    it('continues when activity start or completion callbacks throw', async () => {
        const firstRuntime = runtimeBus();
        const firstHost = { handle: vi.fn(async () => ({ ok: true, result: 'first' })) };
        attachChromeRuntime(firstHost, firstRuntime, {
            onActivity: () => { throw new Error('activity start failed'); },
        });
        await expect(firstRuntime.emit({ type: 'wallet.list' })).resolves.toEqual({
            ok: true,
            result: 'first',
        });

        const secondRuntime = runtimeBus();
        const secondHost = { handle: vi.fn(async () => ({ ok: true, result: 'second' })) };
        attachChromeRuntime(secondHost, secondRuntime, {
            onActivity: () => () => { throw new Error('activity finish failed'); },
        });
        await expect(secondRuntime.emit({ type: 'wallet.list' })).resolves.toEqual({
            ok: true,
            result: 'second',
        });
    });

    it('serializes an unexpected host throw for an untrusted bridge caller', async () => {
        const runtime = runtimeBus();
        attachChromeRuntime({
            handle: () => { throw new TypeError('host exploded'); },
        }, runtime);

        await expect(runtime.emit({
            type: 'bridge.getAccounts',
            request: { origin: WEB.origin },
        }, WEB)).resolves.toEqual({
            ok: false,
            error: {
                name: 'TypeError',
                message: 'host exploded',
                code: 'INTERNAL_ERROR',
            },
        });
    });

    it('repairs a malformed web-visible failure envelope', async () => {
        const runtime = runtimeBus();
        attachChromeRuntime({ handle: async () => ({ ok: false }) }, runtime);

        await expect(runtime.emit({
            type: 'bridge.getAccounts',
            request: { origin: WEB.origin },
        }, WEB)).resolves.toEqual({
            ok: false,
            error: {
                name: 'BridgeError',
                code: 'INTERNAL_ERROR',
                message: 'bridge: INTERNAL_ERROR',
            },
        });
    });

    it('keeps encoder classification private to trusted wallet surfaces', async () => {
        const response = {
            ok: false,
            error: {
                name: 'SDKEncoderError',
                message: 'Encoder RPC error: rejected',
                code: 'INTERNAL_ERROR',
                rpcCode: -32010,
                rpcReason: 'NODE_REJECTED',
            },
        };
        const trustedRuntime = runtimeBus();
        attachChromeRuntime({ handle: async () => response }, trustedRuntime);
        await expect(trustedRuntime.emit({ type: 'wallet.list' })).resolves.toEqual(response);

        const webRuntime = runtimeBus();
        attachChromeRuntime({ handle: async () => response }, webRuntime);
        const published = await webRuntime.emit({
            type: 'bridge.getAccounts', request: { origin: WEB.origin },
        }, WEB);
        expect(published.error).not.toHaveProperty('rpcCode');
        expect(published.error).not.toHaveProperty('rpcReason');
    });

    it('adds the browser-supplied requester tab without mutating the request', async () => {
        const runtime = runtimeBus();
        const request = { origin: WEB.origin };
        const handle = vi.fn(async () => ({ ok: true }));
        attachChromeRuntime({ handle }, runtime);

        await runtime.emit({ type: 'bridge.getAccounts', request }, WEB);

        expect(handle).toHaveBeenCalledWith({
            type: 'bridge.getAccounts',
            request: { origin: WEB.origin, requesterTabId: 41 },
        });
        expect(request).toEqual({ origin: WEB.origin });
    });

    it('overwrites a page-supplied requester tab with the browser-reported one', async () => {
        const runtime = runtimeBus();
        const request = { origin: WEB.origin, requesterTabId: 999 };
        const handle = vi.fn(async () => ({ ok: true }));
        attachChromeRuntime({ handle }, runtime);

        await runtime.emit({ type: 'bridge.getAccounts', request }, WEB);

        expect(handle.mock.calls[0][0].request).toEqual({ origin: WEB.origin, requesterTabId: 41 });
        expect(request.requesterTabId).toBe(999);
    });

    it.each([
        ['no tab', { id: EXT_ID, origin: 'https://app.example' }],
        ['a non-integer tab id', { id: EXT_ID, origin: 'https://app.example', tab: { id: '41' } }],
    ])('drops a page-supplied requester tab when the sender has %s', async (_label, sender) => {
        const runtime = runtimeBus();
        const request = { origin: WEB.origin, requesterTabId: 999 };
        const handle = vi.fn(async () => ({ ok: true }));
        attachChromeRuntime({ handle }, runtime);

        await runtime.emit({ type: 'bridge.getAccounts', request }, sender);

        const forwarded = handle.mock.calls[0][0].request;
        expect(forwarded).toEqual({ origin: WEB.origin });
        expect('requesterTabId' in forwarded).toBe(false);
        expect(request.requesterTabId).toBe(999);
    });
});
