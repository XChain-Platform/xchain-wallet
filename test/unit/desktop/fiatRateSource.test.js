// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configureFiatRateSource, sendMessage } = vi.hoisted(() => ({
    configureFiatRateSource: vi.fn(),
    sendMessage: vi.fn(),
}));

vi.mock('@xchain-wallet/core', () => ({
    flows: { configureFiatRateSource },
}));
vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({ sendMessage }));

const { installDesktopFiatRateSource } = await import('../../../packages/desktop/renderer/fiatRateSource.js');

beforeEach(() => {
    configureFiatRateSource.mockReset();
    sendMessage.mockReset();
});

describe('desktop fiat rate source', () => {
    it('routes URL objects through the main-process price fetch', async () => {
        const body = { bitcoin: { usd: 68000 } };
        sendMessage.mockResolvedValue({ ok: 1, status: '200', body });

        installDesktopFiatRateSource();

        expect(configureFiatRateSource).toHaveBeenCalledOnce();
        const { fetch } = configureFiatRateSource.mock.calls[0][0];
        const response = await fetch(new URL('https://rates.example/simple'));

        expect(sendMessage).toHaveBeenCalledWith('prices.fiatFetch', {
            url: 'https://rates.example/simple',
        });
        expect(response).toMatchObject({ ok: true, status: 200 });
        await expect(response.json()).resolves.toBe(body);
    });

    it('normalizes a malformed host reply to a failed response', async () => {
        sendMessage.mockResolvedValue(undefined);
        installDesktopFiatRateSource();
        const { fetch } = configureFiatRateSource.mock.calls[0][0];

        const response = await fetch('https://rates.example/missing');

        expect(response).toMatchObject({ ok: false, status: 0 });
        await expect(response.json()).resolves.toBeUndefined();
    });

    it('preserves transport failures', async () => {
        const error = new Error('main process unavailable');
        sendMessage.mockRejectedValue(error);
        installDesktopFiatRateSource();
        const { fetch } = configureFiatRateSource.mock.calls[0][0];

        await expect(fetch('https://rates.example/down')).rejects.toBe(error);
    });
});
