// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: asynchronous selection changes.
//
//   [P1] 2026-10-13: Switching the requested coin set can leave the prior
//        price request alive long enough to publish stale data.
//
//   [P1] 2026-10-13: Switching fiat currency can leave the prior currency's
//        price request alive after the selection changes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
    useFiatRate,
    useNativeFiatRates,
} from '../../packages/core/src/shared/hooks/useFiatRate.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../packages/core/src/flows/priceLookup.js';

const EXPLORERS = {
    bitcoin: 'https://bitcoin.example',
    litecoin: 'https://litecoin.example',
};

function pendingPriceSource() {
    const requests = [];
    configureFiatRateSource({
        now: () => Date.parse('2026-10-13T12:00:00Z'),
        explorerUrlByCoin: EXPLORERS,
        fetch: (url, init) => new Promise((_resolve, reject) => {
            requests.push({ url: String(url), signal: init.signal });
            init.signal.addEventListener('abort', () => reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
            ));
        }),
    });
    return requests;
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => _resetPriceLookupForTests());

describe('regression/async-switch-races', () => {
    it('[REGRESSION P1] cancels the old coin request when the selected coins switch', async () => {
        const requests = pendingPriceSource();
        const view = renderHook(
            ({ chainCoins }) => useNativeFiatRates({ chainCoins }),
            { initialProps: { chainCoins: ['bitcoin'] } },
        );
        await waitFor(() => expect(requests).toHaveLength(1));
        const bitcoinRequest = requests[0];

        view.rerender({ chainCoins: ['litecoin'] });

        await waitFor(() => expect(bitcoinRequest.signal.aborted).toBe(true));
        await waitFor(() => expect(requests.some((request) => request.url.includes('LTC'))).toBe(true));
        view.unmount();
    });

    it('[REGRESSION P1] cancels the old rate request when fiat currency switches', async () => {
        const requests = pendingPriceSource();
        const view = renderHook(
            ({ fiatCurrency }) => useFiatRate({ chainCoin: 'bitcoin', fiatCurrency }),
            { initialProps: { fiatCurrency: 'USD' } },
        );
        await waitFor(() => expect(requests).toHaveLength(1));
        const dollarRequest = requests[0];

        view.rerender({ fiatCurrency: 'EUR' });

        await waitFor(() => expect(dollarRequest.signal.aborted).toBe(true));
        await waitFor(() => expect(requests.some(
            (request) => request.url.toLowerCase().includes('eur'),
        )).toBe(true));
        view.unmount();
    });
});
