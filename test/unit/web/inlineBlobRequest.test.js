// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';

const { sendToHost } = vi.hoisted(() => ({ sendToHost: vi.fn() }));

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: sendToHost,
}));

const { sendMessage } = await import('../../../packages/web/src/messaging.js');

const LARGE_FILE_BYTES = 200 * 1024 * 1024;
const READ_METHODS = ['arrayBuffer', 'text', 'stream', 'slice'];

function largeFileStub() {
    const file = new File([], 'large-file.bin', { type: 'application/octet-stream' });
    Object.defineProperties(file, {
        size: { configurable: true, value: LARGE_FILE_BYTES },
        arrayBuffer: { configurable: true, value: vi.fn() },
        text: { configurable: true, value: vi.fn() },
        stream: { configurable: true, value: vi.fn() },
        slice: { configurable: true, value: vi.fn() },
    });
    return file;
}

function expectFileUnread(file) {
    for (const method of READ_METHODS) expect(file[method]).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('inline web and mobile file requests', () => {
    it('passes the request object unchanged to the in-page host bridge', async () => {
        const file = largeFileStub();
        const request = { uploadId: 'upload-1', file };
        const result = { accepted: true };
        sendToHost.mockResolvedValue(result);

        await expect(sendMessage('file.inline', request)).resolves.toBe(result);

        expect(file).toBeInstanceOf(File);
        expect(file).toBeInstanceOf(Blob);
        expect(file.size).toBe(LARGE_FILE_BYTES);
        expect(sendToHost).toHaveBeenCalledOnce();
        expect(sendToHost).toHaveBeenCalledWith('file.inline', request);
        expect(sendToHost.mock.calls[0][1]).toBe(request);
        expect(sendToHost.mock.calls[0][1].file).toBe(file);
        expectFileUnread(file);
    });

    it.each([
        ['bare', false],
        ['through a spend-claim-shaped wrap', true],
    ])('gives the registered handler the same File by identity when %s', async (_label, wrapped) => {
        const file = largeFileStub();
        const request = { uploadId: 'upload-2', file };
        const deps = { vault: {}, chainRegistry: {}, sdkRegistry: {} };
        const host = new MessageHost(deps);
        const handler = vi.fn((received) => received.file);
        const withSpendClaim = vi.fn((_req, _routeDeps, run) => run({ ...deps, claim: {} }));
        host.register('file.inline', handler);

        if (wrapped) {
            host.wrap(
                'file.inline',
                (registered) => (req, routeDeps) => withSpendClaim(
                    req,
                    routeDeps,
                    (claimDeps) => registered(req, claimDeps),
                ),
            );
        }

        const response = await host.handle({ type: 'file.inline', request });

        expect(response.ok).toBe(true);
        expect(response.result).toBe(file);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0]).toBe(request);
        expect(handler.mock.calls[0][0].file).toBe(file);
        if (wrapped) {
            expect(withSpendClaim).toHaveBeenCalledOnce();
            expect(withSpendClaim.mock.calls[0][0]).toBe(request);
        } else {
            expect(withSpendClaim).not.toHaveBeenCalled();
        }
        expectFileUnread(file);
    });
});
