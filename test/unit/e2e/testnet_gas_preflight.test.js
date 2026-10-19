// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { preflightGasHeadroom } from '../../e2e/fixtures/testnet_gas_preflight.js';

const explorerUrl = 'https://explorer.invalid/base';
const coin = 'TBTC';

function reply(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn(async () => body),
    };
}

describe('testnet gas headroom preflight', () => {
    it('refuses a capped token whose headroom is below the mint amount', async () => {
        const fetch = vi.fn(async () => reply(200, {
            supply: { max: '300', current: '100.5' },
        }));

        await expect(preflightGasHeadroom(200, { explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom preflight refused: headroom 199.5 is below amount 200');
        expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`^${explorerUrl}`));
    });

    it('passes when headroom equals the mint amount', async () => {
        const fetch = vi.fn(async () => reply(200, {
            supply: { max: '300', current: '100' },
        }));

        await expect(preflightGasHeadroom(200, { explorerUrl, coin, fetch }))
            .resolves.toBe('200');
    });

    it('passes with null when the gas token has no capped record', async () => {
        const fetch = vi.fn(async () => reply(404));

        await expect(preflightGasHeadroom(200, { explorerUrl, coin, fetch }))
            .resolves.toBeNull();
    });

    it('propagates a headroom read failure', async () => {
        const fetch = vi.fn(async () => reply(500));

        await expect(preflightGasHeadroom(200, { explorerUrl, coin, fetch }))
            .rejects.toThrow('Gas headroom read failed: HTTP 500');
    });
});
