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
});
