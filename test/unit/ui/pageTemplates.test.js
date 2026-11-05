// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ExecuteContractForm's wrap() helper is a bare Screen. The load error, the
// loading line and the broadcast panel reach the page through a ListPage
// inside that Screen, the same as DeployContractForm, so none of them draws
// straight into the Screen body with its own spacing.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, screen } from '@testing-library/react';

import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qdevmock02aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function listPageClass() {
    const list = render(React.createElement(ListPage, null, React.createElement('p', null, 'x')));
    const name = list.container.firstChild.className.split(' ')[0];
    list.unmount();
    return name;
}

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getContractByActionIndex: () => Promise.resolve({}),
        composeForConfirm: () => Promise.resolve({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        executeAction: () => Promise.resolve({ txid: 'tx-execute-0001' }),
        ...overrides,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return () => Promise.resolve(null);
        },
    });
}

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mountExecute(overrides) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingFor(overrides) },
            React.createElement(ExecuteContractForm, {
                walletId: 'w', chainId: CHAIN, contractActionIndex: '9', onBack() {},
            }),
        ));
        await drain();
    });
    return utils;
}

// The element sits in a ListPage, and that ListPage is the only content the
// Screen body carries: nothing else is a bare child of the body.
function expectInListPageWithinScreen(element) {
    const listClass = listPageClass();
    const page = element.closest(`.${CSS.escape(listClass)}`);
    expect(page, 'inside ListPage').not.toBeNull();
    const body = page.parentElement;
    expect(body, 'ListPage sits in the Screen body').not.toBeNull();
    const bare = Array.from(body.children).filter((child) => child !== page && child.childNodes.length > 0);
    expect(bare.map((child) => child.outerHTML), 'no bare content beside the ListPage').toEqual([]);
}

describe('ExecuteContractForm: the load error, loading line and broadcast panel render inside ListPage', () => {
    beforeEach(() => {
        __clearTokenInfoCache();
        vi.useFakeTimers({
            toFake: [
                'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
                'setImmediate', 'clearImmediate', 'requestAnimationFrame',
                'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
            ],
        });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('lays out the load error inside ListPage', async () => {
        await mountExecute({
            getAddressesByChain: () => Promise.reject(new Error('Address store unavailable')),
        });
        expectInListPageWithinScreen(screen.getByText('Address store unavailable'));
    });

    it('lays out the loading line inside ListPage', async () => {
        await mountExecute({ getAddressesByChain: () => new Promise(() => {}) });
        expectInListPageWithinScreen(screen.getByText('Loading addresses…'));
    });

    it('lays out the broadcast summary, details and Done inside one ListPage', async () => {
        const utils = await mountExecute();
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Method'), { target: { value: 'transfer' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Call contract' }));
            await drain();
        });
        await domAct(async () => {
            const approve = Array.from(utils.container.querySelectorAll('button'))
                .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
            if (!approve) throw new Error('no enabled Approve button on the confirm page');
            fireEvent.click(approve);
            await drain();
        });

        const summary = screen.getByText('Method call broadcast.');
        const txid = screen.getByText('tx-execute-0001');
        const done = screen.getByRole('button', { name: 'Done' });
        expectInListPageWithinScreen(summary);
        const page = summary.closest(`.${CSS.escape(listPageClass())}`);
        expect(page.contains(txid.closest('dl'))).toBe(true);
        expect(page.contains(done)).toBe(true);
        for (const block of [summary, txid.closest('dl'), done.parentElement]) {
            expect(block.parentElement, 'the panel block is a ListPage child, not a Screen body child').toBe(page);
        }
    });
});
