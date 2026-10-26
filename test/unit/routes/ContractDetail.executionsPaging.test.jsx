// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The execution history pager divides the explorer's total by a page size. That
// size is the explorer's, not the number of rows on the page on screen: the last
// page is short, so using its row count invented extra pages ("Page 3 of 6"),
// kept Next live on the final page, and a click on it landed on an empty page
// with no pager at all.

import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const PAGE_SIZE = 25;
const TOTAL = 60;

function pageRows(page) {
    const start = (page - 1) * PAGE_SIZE;
    const count = Math.max(0, Math.min(PAGE_SIZE, TOTAL - start));
    return Array.from({ length: count }, (_, i) => ({
        action_index: String(1000 + start + i),
        method: 'release',
        status: 'valid',
        block_index: 840000 + i,
    }));
}

function harness() {
    const target = {
        getAddressesByChain: () => Promise.resolve({}),
        getActiveAddresses: () => Promise.resolve({}),
        getContractByActionIndex: () => Promise.resolve({ data: { action_index: '49', status: 'valid' } }),
        getActionByIndex: () => Promise.resolve({}),
        getContractState: () => Promise.resolve({}),
        getContractBalance: () => Promise.resolve({}),
        getExecutionsForContract: ({ opts }) => Promise.resolve({ data: pageRows(opts.page), total: TOTAL }),
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

function button(utils, pattern) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => pattern.test(b.textContent || ''));
}

async function mount() {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: harness() },
                React.createElement(ContractDetail, { chainId: CHAIN, contractActionIndex: '49', onBack() {} }),
            ),
        );
        await drain();
    });
    return utils;
}

async function press(utils, pattern) {
    await domAct(async () => {
        button(utils, pattern).click();
        await drain();
    });
}

describe('Execution history pager', () => {
    it('counts pages by the explorer page size, not by the rows on the last page', async () => {
        const utils = await mount();
        expect(utils.container.textContent).toContain('Page 1 of 3');

        await press(utils, /Next/);
        expect(utils.container.textContent).toContain('Page 2 of 3');

        await press(utils, /Next/);
        expect(utils.container.textContent).toContain('Page 3 of 3');
        // Ten rows are left on the final page and nothing follows them.
        expect(utils.container.textContent).toContain('#1059');
        expect(button(utils, /Next/).disabled).toBe(true);
        expect(button(utils, /Prev/).disabled).toBe(false);
    });

    it('keeps Prev on a page past the end', async () => {
        const messaging = new Proxy({
            getAddressesByChain: () => Promise.resolve({}),
            getContractByActionIndex: () => Promise.resolve({ data: { action_index: '49', status: 'valid' } }),
            getExecutionsForContract: ({ opts }) => Promise.resolve({
                data: opts.page === 1 ? pageRows(1) : [],
                total: TOTAL,
            }),
        }, {
            get(t, prop) {
                if (prop in t) return t[prop];
                return () => Promise.resolve({});
            },
        });
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
        await press(utils, /Next/);
        expect(utils.container.textContent).toContain('No contract calls yet');
        const prev = button(utils, /Prev/);
        expect(prev).toBeTruthy();
        await press(utils, /Prev/);
        expect(utils.container.textContent).toContain('#1000');
    });
});
