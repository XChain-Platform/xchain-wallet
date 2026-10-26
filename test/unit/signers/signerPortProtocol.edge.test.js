// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    bindRendererPortBridge,
    createBackgroundTransport,
} from '../../../packages/core/src/signers/signerPortProtocol.js';

function event() {
    const listeners = new Set();
    return {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
        async emit(message) {
            await Promise.all([...listeners].map((listener) => listener(message)));
        },
    };
}

function portWithoutDisconnect() {
    return { postMessage: vi.fn(), onMessage: event() };
}

describe('signer port protocol edge failures', () => {
    it('operates without an optional disconnect event', async () => {
        const port = portWithoutDisconnect();
        const pending = createBackgroundTransport(port)({ op: 'status', payload: {} });
        await port.onMessage.emit({ kind: 'response', reqId: 1, ok: true, result: 'available' });
        await expect(pending).resolves.toBe('available');
    });

    it.each([
        [{}, 'Error', 'renderer returned no message'],
        [{ name: '', message: '' }, 'Error', 'renderer returned no message'],
    ])('supplies defaults for an incomplete renderer error %#', async (error, name, message) => {
        const port = portWithoutDisconnect();
        const pending = createBackgroundTransport(port)({ op: 'status', payload: {} });
        await port.onMessage.emit({ kind: 'response', reqId: 1, ok: false, error });
        await expect(pending).rejects.toMatchObject({ name, message });
    });

    it.each([null, 7, 'device refused'])('serializes a thrown non-Error value (%j)', async (failure) => {
        const port = portWithoutDisconnect();
        bindRendererPortBridge(port, {
            getSigner: () => ({ getStatus: async () => { throw failure; } }),
        });

        await port.onMessage.emit({
            kind: 'request', reqId: 4, op: 'status', payload: { signerId: 'signer-a' },
        });

        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'response',
            reqId: 4,
            ok: false,
            error: { name: 'Error', message: String(failure) },
        });
    });

    it.each(['', Object.assign(new Error(''), { name: '' })])(
        'never sends an empty error name or message, which a strict bridge would drop (%#)',
        async (failure) => {
            const port = portWithoutDisconnect();
            bindRendererPortBridge(port, {
                getSigner: () => ({ getStatus: async () => { throw failure; } }),
            });
            await port.onMessage.emit({
                kind: 'request', reqId: 6, op: 'status', payload: { signerId: 'signer-a' },
            });
            const [[frame]] = port.postMessage.mock.calls;
            expect(frame.ok).toBe(false);
            expect(frame.error.name).toMatch(/\S/);
            expect(frame.error.message).toMatch(/\S/);
        },
    );

    it('answers with an error when the success frame itself is refused', async () => {
        const port = portWithoutDisconnect();
        port.postMessage.mockImplementationOnce(() => { throw new TypeError('frame refused'); });
        bindRendererPortBridge(port, { getSigner: () => ({ getStatus: async () => 'available' }) });
        await port.onMessage.emit({
            kind: 'request', reqId: 7, op: 'status', payload: { signerId: 'signer-a' },
        });
        expect(port.postMessage).toHaveBeenLastCalledWith({
            kind: 'response', reqId: 7, ok: false, error: { name: 'TypeError', message: 'frame refused' },
        });
    });

    it('swallows a closed port while sending an error response', async () => {
        const port = portWithoutDisconnect();
        port.postMessage.mockImplementation(() => { throw new Error('closed'); });
        bindRendererPortBridge(port, { getSigner: () => null });

        await expect(port.onMessage.emit({
            kind: 'request', reqId: 5, op: 'status', payload: { signerId: 'missing' },
        })).resolves.toBeUndefined();
    });

    it('swallows closed-port announce and dispose failures', () => {
        const port = portWithoutDisconnect();
        port.postMessage.mockImplementation(() => { throw new Error('closed'); });
        port.onMessage.removeListener.mockImplementation(() => { throw new Error('closed'); });
        const bridge = bindRendererPortBridge(port, { getSigner: () => null });

        expect(() => bridge.announce(['signer-a'])).not.toThrow();
        expect(() => bridge.dispose()).not.toThrow();
    });
});
