/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
    clearTransport: vi.fn(),
    setTransport: vi.fn(),
}));
const ports = vi.hoisted(() => []);
const createBackgroundTransport = vi.hoisted(() => vi.fn((port) => {
    ports.push(port);
    return { portNumber: ports.length };
}));

vi.mock('@xchain-wallet/core/signers', () => ({ createBackgroundTransport }));
vi.mock('@xchain-wallet/extension/src/background/signerBridge.js', () => bridge);

import { attachSignerBridgeListener } from '../../../packages/desktop/main/signerBridgeListener.js';

function fakeIpc() {
    let listener;
    return {
        on: vi.fn((_channel, fn) => { listener = fn; }),
        off: vi.fn(),
        emit: (event, message) => listener(event, message),
    };
}

function fakeSender(id) {
    const listeners = new Map();
    return {
        id,
        listeners,
        isDestroyed: vi.fn(() => false),
        on: vi.fn((event, fn) => listeners.set(event, fn)),
        removeListener: vi.fn((event) => listeners.delete(event)),
        send: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    ports.length = 0;
});

describe('signer bridge ownership and quota branches', () => {
    it('fails closed when the sender trust predicate is omitted', () => {
        const ipcMain = fakeIpc();
        attachSignerBridgeListener({ ipcMain });

        ipcMain.emit({ sender: fakeSender(1) }, { kind: 'register', signerIds: ['ledger-1'] });

        expect(createBackgroundTransport).not.toHaveBeenCalled();
    });

    it('drops oversized batches and cumulative additions, then reuses freed capacity', () => {
        const ipcMain = fakeIpc();
        const sender = fakeSender(1);
        attachSignerBridgeListener({
            ipcMain,
            isTrustedSender: () => true,
            maxSignerIdsPerMessage: 2,
            maxSignerIdsPerSender: 2,
        });

        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['a', 'b', 'c'] });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['a'] });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['a', 'b'] });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['c'] });
        ipcMain.emit({ sender }, { kind: 'unregister', signerIds: ['missing', 'a'] });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['c'] });

        expect(bridge.setTransport.mock.calls.map(([id]) => id)).toEqual(['a', 'a', 'b', 'c']);
        expect(bridge.clearTransport).toHaveBeenCalledExactlyOnceWith('a');
    });

    it('keeps a live owner and permits takeover only after that document ends', () => {
        const ipcMain = fakeIpc();
        const first = fakeSender(1);
        const second = fakeSender(2);
        attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });

        ipcMain.emit({ sender: first }, { kind: 'register', signerIds: ['shared'] });
        ipcMain.emit({ sender: second }, { kind: 'register', signerIds: ['shared', 'second-only'] });
        first.listeners.get('destroyed')();
        ipcMain.emit({ sender: second }, { kind: 'register', signerIds: ['shared'] });

        expect(bridge.setTransport.mock.calls).toEqual([
            ['shared', { portNumber: 1 }],
            ['second-only', { portNumber: 2 }],
            ['shared', { portNumber: 2 }],
        ]);
    });

    it('supports listener removal and contains message and disconnect listener failures', () => {
        const ipcMain = fakeIpc();
        const sender = fakeSender(1);
        const detach = attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['a'] });
        const port = ports[0];
        const removedMessage = vi.fn();
        const removedDisconnect = vi.fn();
        port.onMessage.addListener(removedMessage);
        port.onMessage.removeListener(removedMessage);
        port.onMessage.addListener(() => { throw new Error('listener failed'); });
        port.onDisconnect.addListener(removedDisconnect);
        port.onDisconnect.removeListener(removedDisconnect);
        port.onDisconnect.addListener(() => { throw new Error('disconnect failed'); });

        expect(() => ipcMain.emit({ sender }, { kind: 'unregister', signerIds: ['a'] })).not.toThrow();
        expect(() => detach()).not.toThrow();
        expect(removedMessage).not.toHaveBeenCalled();
        expect(removedDisconnect).not.toHaveBeenCalled();
    });
});
