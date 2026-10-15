/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
    clearTransport: vi.fn(),
    setTransport: vi.fn(),
}));
const transportState = vi.hoisted(() => ({
    disconnects: [],
    ports: [],
}));
const createBackgroundTransport = vi.hoisted(() => vi.fn((port) => {
    const transport = { sequence: transportState.ports.length + 1 };
    const disconnected = vi.fn();
    port.onDisconnect.addListener(disconnected);
    transportState.disconnects.push(disconnected);
    transportState.ports.push(port);
    return transport;
}));

vi.mock('@xchain-wallet/core/signers', () => ({ createBackgroundTransport }));
vi.mock('@xchain-wallet/extension/src/background/signerBridge.js', () => bridge);

import {
    SIGNER_BRIDGE_CHANNEL,
    attachSignerBridgeListener,
} from '../../../packages/desktop/main/signerBridgeListener.js';

function fakeIpc() {
    let listener;
    return {
        on: vi.fn((_channel, fn) => { listener = fn; }),
        off: vi.fn(),
        emit: (event, message) => listener(event, message),
    };
}

function fakeSender(id = 7) {
    const listeners = new Map();
    return {
        id,
        listeners,
        isDestroyed: vi.fn(() => false),
        on: vi.fn((name, fn) => { listeners.set(name, fn); }),
        removeListener: vi.fn((name) => { listeners.delete(name); }),
        send: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    transportState.disconnects.length = 0;
    transportState.ports.length = 0;
});

describe('desktop signer bridge edge branches', () => {
    it('requires ipcMain and ignores absent, untrusted, and malformed senders', () => {
        expect(() => attachSignerBridgeListener({})).toThrow(/ipcMain.on is required/);
        const ipcMain = fakeIpc();
        attachSignerBridgeListener({ ipcMain, isTrustedSender: (event) => event.trusted === true });

        ipcMain.emit({}, { kind: 'register', signerIds: ['ledger-1'] });
        ipcMain.emit({ sender: fakeSender() }, { kind: 'register', signerIds: ['ledger-1'] });
        ipcMain.emit({ sender: fakeSender(), trusted: true }, { kind: 'register', signerIds: [3] });

        expect(createBackgroundTransport).not.toHaveBeenCalled();
        expect(bridge.setTransport).not.toHaveBeenCalled();
    });

    it.each(['destroyed', 'did-navigate', 'render-process-gone'])(
        'clears owned transports when the document reports %s',
        (eventName) => {
            const ipcMain = fakeIpc();
            const sender = fakeSender();
            attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });
            ipcMain.emit({ sender }, { kind: 'register', signerIds: ['ledger-1'] });

            sender.listeners.get(eventName)();
            sender.listeners.get(eventName)?.();

            expect(bridge.setTransport).toHaveBeenCalledWith('ledger-1', { sequence: 1 });
            expect(bridge.clearTransport).toHaveBeenCalledExactlyOnceWith('ledger-1');
            expect(transportState.disconnects[0]).toHaveBeenCalledOnce();
            expect(sender.removeListener).toHaveBeenCalledTimes(3);
        },
    );

    it('builds a fresh transport for the next document on the same webContents', () => {
        const ipcMain = fakeIpc();
        const sender = fakeSender();
        attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });

        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['ledger-1'] });
        sender.listeners.get('did-navigate')();
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['ledger-1'] });

        expect(createBackgroundTransport).toHaveBeenCalledTimes(2);
        expect(bridge.setTransport.mock.calls).toEqual([
            ['ledger-1', { sequence: 1 }],
            ['ledger-1', { sequence: 2 }],
        ]);
    });

    it('contains renderer send failures and refuses sends to destroyed contents', () => {
        const ipcMain = fakeIpc();
        const sender = fakeSender();
        attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['ledger-1'] });
        const port = transportState.ports[0];

        sender.send.mockImplementationOnce(() => { throw new Error('destroyed mid-send'); });
        expect(() => port.postMessage({ kind: 'request' })).not.toThrow();
        sender.isDestroyed.mockReturnValue(true);
        port.postMessage({ kind: 'request' });

        expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('detaches even when ipcMain.off and sender cleanup hooks throw', () => {
        const ipcMain = fakeIpc();
        ipcMain.off.mockImplementation(() => { throw new Error('already gone'); });
        const sender = fakeSender();
        sender.removeListener.mockImplementation(() => { throw new Error('already gone'); });
        const detach = attachSignerBridgeListener({ ipcMain, isTrustedSender: () => true });
        ipcMain.emit({ sender }, { kind: 'register', signerIds: ['ledger-1'] });

        expect(detach).not.toThrow();
        expect(bridge.clearTransport).toHaveBeenCalledWith('ledger-1');
        expect(ipcMain.off).toHaveBeenCalledWith(SIGNER_BRIDGE_CHANNEL, expect.any(Function));
    });
});
