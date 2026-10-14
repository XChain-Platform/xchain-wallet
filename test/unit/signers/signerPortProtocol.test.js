// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import {
    bindRendererPortBridge,
    createBackgroundTransport,
} from '../../../packages/core/src/signers/signerPortProtocol.js';

function createEvent() {
    const listeners = new Set();
    return {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
        async emit(value) {
            await Promise.all(Array.from(listeners, (listener) => listener(value)));
        },
        get size() { return listeners.size; },
    };
}

function createPort() {
    return {
        postMessage: vi.fn(),
        onMessage: createEvent(),
        onDisconnect: createEvent(),
    };
}

describe('signers/signerPortProtocol createBackgroundTransport', () => {
    it('assigns request ids and correlates out-of-order responses', async () => {
        const port = createPort();
        const transport = createBackgroundTransport(port);
        const first = transport({ op: 'status', payload: { signerId: 'signer-a' } });
        const second = transport({ op: 'getPublicKey', payload: { signerId: 'signer-b' } });

        expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
            { kind: 'request', reqId: 1, op: 'status', payload: { signerId: 'signer-a' } },
            { kind: 'request', reqId: 2, op: 'getPublicKey', payload: { signerId: 'signer-b' } },
        ]);

        await port.onMessage.emit({ kind: 'notice', reqId: 1, result: 'ignored' });
        await port.onMessage.emit({ kind: 'response', reqId: 99, ok: true, result: 'ignored' });
        await port.onMessage.emit({ kind: 'response', reqId: 2, ok: true, result: { publicKey: '02aa' } });
        await port.onMessage.emit({ kind: 'response', reqId: 1, ok: true, result: 'available' });

        await expect(first).resolves.toBe('available');
        await expect(second).resolves.toEqual({ publicKey: '02aa' });
    });

    it('recreates renderer errors with their name and message', async () => {
        const port = createPort();
        const pending = createBackgroundTransport(port)({
            op: 'signMessage',
            payload: { signerId: 'signer-a' },
        });

        await port.onMessage.emit({
            kind: 'response',
            reqId: 1,
            ok: false,
            error: { name: 'UserRejectedError', message: 'request rejected' },
        });

        await expect(pending).rejects.toMatchObject({
            name: 'UserRejectedError',
            message: 'request rejected',
        });
    });

    it('rejects pending and future calls after disconnect', async () => {
        const port = createPort();
        const transport = createBackgroundTransport(port);
        const first = transport({ op: 'status', payload: { signerId: 'signer-a' } });
        const second = transport({ op: 'status', payload: { signerId: 'signer-b' } });

        await port.onDisconnect.emit();

        await expect(first).rejects.toThrow('signer bridge disconnected');
        await expect(second).rejects.toThrow('signer bridge disconnected');
        await expect(transport({ op: 'status', payload: { signerId: 'signer-c' } }))
            .rejects.toThrow('signer bridge disconnected');
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    it('rejects when posting the request throws', async () => {
        const port = createPort();
        port.postMessage.mockImplementation(() => { throw new Error('closed port'); });
        const transport = createBackgroundTransport(port);

        await expect(transport({ op: 'status', payload: { signerId: 'signer-a' } }))
            .rejects.toThrow('closed port');
    });
});

describe('signers/signerPortProtocol bindRendererPortBridge', () => {
    it.each([
        ['status', 'getStatus', 'available'],
        ['getAddresses', 'getAddresses', [{ address: 'bc1qexample' }]],
        ['getPublicKey', 'getPublicKey', { publicKey: '02aa' }],
        ['signPsbt', 'signPsbt', { txHex: '00', txid: '11' }],
        ['signMessage', 'signMessage', { signature: '22' }],
    ])('dispatches %s to signer.%s', async (op, method, result) => {
        const port = createPort();
        const signer = { [method]: vi.fn().mockResolvedValue(result) };
        const getSigner = vi.fn(() => signer);
        bindRendererPortBridge(port, { getSigner });
        const payload = { signerId: 'signer-a', chainId: 'bitcoin-mainnet' };

        await port.onMessage.emit({ kind: 'request', reqId: 7, op, payload });

        expect(getSigner).toHaveBeenCalledWith('signer-a');
        expect(signer[method]).toHaveBeenCalledWith(payload);
        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'response', reqId: 7, ok: true, result,
        });
    });

    it.each([
        [
            { kind: 'request', reqId: 1, op: 'status', payload: {} },
            'Error',
            'request missing signerId',
        ],
        [
            { kind: 'request', reqId: 2, op: 'status', payload: { signerId: 'missing' } },
            'SignerNotRegisteredError',
            'no renderer signer registered',
        ],
        [
            { kind: 'request', reqId: 3, op: 'eraseDevice', payload: { signerId: 'signer-a' } },
            'Error',
            'unknown op',
        ],
    ])('returns a serializable dispatch error for request $reqId', async (request, name, message) => {
        const port = createPort();
        bindRendererPortBridge(port, {
            getSigner: (id) => (id === 'signer-a' ? {} : null),
        });

        await port.onMessage.emit(request);

        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'response',
            reqId: request.reqId,
            ok: false,
            error: { name, message: expect.stringContaining(message) },
        });
    });

    it('preserves errors thrown by the signer', async () => {
        const port = createPort();
        const failure = Object.assign(new Error('device declined'), { name: 'UserRejectedError' });
        bindRendererPortBridge(port, {
            getSigner: () => ({ signMessage: vi.fn().mockRejectedValue(failure) }),
        });

        await port.onMessage.emit({
            kind: 'request', reqId: 4, op: 'signMessage', payload: { signerId: 'signer-a' },
        });

        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'response',
            reqId: 4,
            ok: false,
            error: { name: 'UserRejectedError', message: 'device declined' },
        });
    });

    it('announces copied signer ids and removes its listener on dispose', async () => {
        const port = createPort();
        const bridge = bindRendererPortBridge(port, { getSigner: () => null });
        const signerIds = new Set(['signer-a', 'signer-b']);

        bridge.announce(signerIds);
        expect(port.postMessage).toHaveBeenCalledWith({
            kind: 'register', signerIds: ['signer-a', 'signer-b'],
        });
        expect(port.onMessage.size).toBe(1);

        bridge.dispose();
        expect(port.onMessage.size).toBe(0);
        await port.onMessage.emit({
            kind: 'request', reqId: 5, op: 'status', payload: { signerId: 'missing' },
        });
        expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    it('ignores unrelated messages and closed-port response failures', async () => {
        const port = createPort();
        bindRendererPortBridge(port, {
            getSigner: () => ({ getStatus: vi.fn().mockResolvedValue('available') }),
        });

        await port.onMessage.emit({ kind: 'register', signerIds: ['signer-a'] });
        expect(port.postMessage).not.toHaveBeenCalled();

        port.postMessage.mockImplementation(() => { throw new Error('closed port'); });
        await expect(port.onMessage.emit({
            kind: 'request', reqId: 6, op: 'status', payload: { signerId: 'signer-a' },
        })).resolves.toBeUndefined();
    });
});
