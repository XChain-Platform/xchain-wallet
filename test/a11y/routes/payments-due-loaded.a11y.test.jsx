// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Payments due with rows on screen: the one list card of row buttons, each
// with its time ring, what it buys and what it pays, in both the loading and
// the loaded state of the bought side. The route sweep (m-z-routes) only sees
// the empty page.

import React from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const hookState = vi.hoisted(() => ({ obligations: [] }));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: () => ({
        obligations: hookState.obligations,
        scanning: false,
        error: null,
        refresh: () => {},
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => ({ offline: false, recheck: () => {} }),
}));

import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';

const PAYER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const now = Math.floor(Date.now() / 1000);
// The view floors the time left to whole minutes, so each row gets 30 seconds
// of slack: a slow module load before render must not turn 24m into 23m.
const SLACK_SECONDS = 30;

function row(index, minutesLeft, coinAmount) {
    const secondsLeft = minutesLeft * 60 + SLACK_SECONDS;
    return {
        chainId: 'bitcoin-mainnet',
        address: PAYER,
        payeeAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        orderMatchActionIndex: String(index),
        coinAmount,
        expiration: now + secondsLeft,
    };
}

async function mount(getCoinpayMatchSides) {
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={{ getAutopayStatus: async () => null, getCoinpayMatchSides }}>
                <ObligationsView walletId="w" onPay={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => {
    cleanup();
    hookState.obligations = [];
});

describe('Payments due with rows has no serious axe violations', () => {
    it('rows with their bought side', async () => {
        hookState.obligations = [row(700210, 24, '0.0024'), row(700214, 96, '0.0016')];
        const { container, getByRole } = await mount(async () => ({
            'bitcoin-mainnet:700210': { tick: 'XCHAIN', amount: '600', matchedAt: null },
            'bitcoin-mainnet:700214': { tick: 'XCHAIN', amount: '400', matchedAt: null },
        }));
        getByRole('list', { name: 'Payments due' });
        getByRole('button', { name: /^Buying 600 XCHAIN, Pay 0\.0024 BTC, 24m left$/ });
        await expectNoSeriousAxeViolations(container);
    });

    it('rows still loading what they buy', async () => {
        hookState.obligations = [row(700210, 24, '0.0024')];
        const { container, getByRole } = await mount(() => new Promise(() => {}));
        getByRole('button', { name: /^Buying, Pay 0\.0024 BTC, 24m left$/ });
        await expectNoSeriousAxeViolations(container);
    });
});
