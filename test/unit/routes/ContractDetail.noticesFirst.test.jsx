// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every notice is the first item of the page content. The contract detail page
// drew its deployer-can-withdraw warning and a failed publication read under the
// identity block, so the first thing a reader saw was the contract name with the
// warning about its custody two paragraphs below it.

import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';

const CHAIN = 'bitcoin-mainnet';

function harness(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({}),
        getActiveAddresses: () => Promise.resolve({}),
        getContractByActionIndex: () => Promise.resolve({
            data: { action_index: '49', status: 'valid', meta_name: 'Escrow', meta_version: '1.0.0', owner_withdraw: true },
        }),
        getActionByIndex: () => Promise.resolve({}),
        getContractState: () => Promise.resolve({}),
        getContractBalance: () => Promise.resolve({}),
        getExecutionsForContract: () => Promise.resolve({ data: [] }),
        ...overrides,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ContractDetail, { chainId: CHAIN, contractActionIndex: '49', onBack() {} }),
            ),
        );
        await drain();
    });
    return utils;
}

function precedes(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('Contract detail notices', () => {
    it('shows the deployer warning before the contract identity', async () => {
        const utils = await mount(harness());
        const warning = utils.container.querySelector('[data-testid="owner-withdraw-warning"]');
        const heading = utils.container.querySelector('h2');
        expect(warning).toBeTruthy();
        expect(heading).toBeTruthy();
        expect(precedes(warning, heading)).toBe(true);
    });

    it('shows a failed publication read before the contract identity', async () => {
        const utils = await mount(harness({
            getActionByIndex: () => Promise.reject(new Error('Explorer returned HTTP 502 for /BTC/api/action/49')),
        }));
        const alert = utils.container.querySelector('[role="alert"]');
        const heading = utils.container.querySelector('h2');
        expect(alert).toBeTruthy();
        expect(precedes(alert, heading)).toBe(true);
    });
});
