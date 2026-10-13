// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyBets } from '../../../packages/core/src/shared/routes/MyBets.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 's1',
};

afterEach(() => cleanup());

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(Component, messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Component walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return utils;
}

function baseMessaging(overrides) {
    return {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        ...overrides,
    };
}

describe('betting history empty states', () => {
    it('does not call a failed My bets read an empty history', async () => {
        const utils = await mount(MyBets, baseMessaging({
            bets: () => Promise.reject(new Error('explorer unavailable')),
        }));
        const shown = utils.container.textContent || '';
        expect(shown).toMatch(/could not load bets for any of your addresses/i);
        expect(shown).not.toMatch(/have not placed any bets yet/i);
    });

    it('does not call a failed oracle market read an empty history', async () => {
        const utils = await mount(OracleConsole, baseMessaging({
            betFeeds: () => Promise.reject(new Error('explorer unavailable')),
        }));
        const shown = utils.container.textContent || '';
        expect(shown).toMatch(/could not load markets for any of your addresses/i);
        expect(shown).not.toMatch(/have not created any betting markets/i);
    });
});
