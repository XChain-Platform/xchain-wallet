// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as signerBridge from '../../../packages/extension/src/background/signerBridge.js';
import { attachSignerBridgeListener } from '../../../packages/extension/src/background/signerBridgeListener.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TRUSTED = { id: EXT_ID, origin: `chrome-extension://${EXT_ID}` };

function runtimeBus() {
    let listener;
    return {
        id: EXT_ID,
        onConnect: {
            addListener: vi.fn((next) => { listener = next; }),
            removeListener: vi.fn(),
        },
        connect(port) { return listener(port); },
    };
}

function port(sender = TRUSTED) {
    const messages = [];
    const disconnects = [];
    return {
        value: {
            name: 'signer-bridge',
            sender,
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            onMessage: { addListener: (fn) => messages.push(fn) },
            onDisconnect: { addListener: (fn) => disconnects.push(fn) },
        },
        message(payload) { for (const listener of messages) listener(payload); },
        disconnect() { for (const listener of disconnects) listener(); },
    };
}

beforeEach(() => signerBridge.clearAll());
afterEach(() => signerBridge.clearAll());

describe('signer bridge listener edge branches', () => {
    it('rejects a runtime without an onConnect surface', () => {
        expect(() => attachSignerBridgeListener({})).toThrow(
            'chrome.runtime.onConnect is not available',
        );
    });

    it('ignores missing and unrelated ports', () => {
        const runtime = runtimeBus();
        attachSignerBridgeListener(runtime);
        expect(() => runtime.connect(null)).not.toThrow();
        expect(() => runtime.connect({ name: 'other' })).not.toThrow();
        expect(signerBridge.registeredIds()).toEqual([]);
    });

    it('swallows a disconnect refusal from an untrusted port', () => {
        const runtime = runtimeBus();
        attachSignerBridgeListener(runtime);
        expect(() => runtime.connect({
            name: 'signer-bridge',
            sender: { origin: 'https://app.example' },
            disconnect: () => { throw new Error('already disconnected'); },
        })).not.toThrow();
    });

    it('filters invalid ids and ignores unregister requests it does not own', () => {
        const runtime = runtimeBus();
        attachSignerBridgeListener(runtime);
        const connected = port();
        runtime.connect(connected.value);

        connected.message({ kind: 'register', signerIds: ['', null, 42, 'valid-id'] });
        connected.message({ kind: 'unregister', signerIds: ['someone-else'] });

        expect(signerBridge.registeredIds()).toEqual(['valid-id']);
    });

    it('does not let an older port disconnect clear a newer transport', () => {
        const runtime = runtimeBus();
        const detach = attachSignerBridgeListener(runtime);
        const older = port();
        const newer = port();
        runtime.connect(older.value);
        runtime.connect(newer.value);
        older.message({ kind: 'register', signerIds: ['device-1'] });
        const olderTransport = signerBridge.getTransport('device-1');
        newer.message({ kind: 'register', signerIds: ['device-1'] });
        const newerTransport = signerBridge.getTransport('device-1');

        expect(newerTransport).not.toBe(olderTransport);
        older.disconnect();
        expect(signerBridge.getTransport('device-1')).toBe(newerTransport);
        newer.disconnect();
        expect(signerBridge.getTransport('device-1')).toBeNull();

        detach();
        expect(runtime.onConnect.removeListener).toHaveBeenCalledOnce();
    });
});
