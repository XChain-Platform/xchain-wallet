// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configureReleaseFeedSource, sendMessage } = vi.hoisted(() => ({
    configureReleaseFeedSource: vi.fn(),
    sendMessage: vi.fn(),
}));

vi.mock('@xchain-wallet/core', () => ({ flows: { configureReleaseFeedSource } }));
vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({ sendMessage }));

const { installDesktopReleaseFeedSource } = await import('../../../packages/desktop/renderer/releaseFeedSource.js');

beforeEach(() => {
    configureReleaseFeedSource.mockReset();
    sendMessage.mockReset();
});

function installedSource() {
    installDesktopReleaseFeedSource();
    expect(configureReleaseFeedSource).toHaveBeenCalledOnce();
    return configureReleaseFeedSource.mock.calls[0][0].fetchText;
}

describe('desktop release feed source', () => {
    it('asks main for the feed with no request and returns its text', async () => {
        sendMessage.mockResolvedValue({ ok: true, text: '{"latest":"1.0.0"}' });

        await expect(installedSource()()).resolves.toBe('{"latest":"1.0.0"}');
        expect(sendMessage.mock.calls).toEqual([['updates.releaseFeed']]);
    });

    it.each([
        ['a refused fetch', { ok: false, status: 503 }],
        ['a missing reply', undefined],
        ['a non-text body', { ok: true, text: 42 }],
    ])('fails the read on %s', async (_name, reply) => {
        sendMessage.mockResolvedValue(reply);

        await expect(installedSource()()).rejects.toThrow('update feed unavailable');
    });
});
