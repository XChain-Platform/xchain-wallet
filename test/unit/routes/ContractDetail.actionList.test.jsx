// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The contract page as the screen walk's layout 3 (2026-11-14): a white
// identity card with no chart, then Actions | Details | Activity on the
// shared toggle. Actions lists Deposit, Withdraw and Stake here, then View code and View state, then a
// Contract Functions heading and one row per function (each opening its own
// call form) and Call by name. Activity is every call, by anyone, newest
// first, with no "only mine" filter. Details holds the facts and the View
// code and State rows, each opening its own page. A header search narrows
// the tab on screen. Tabs, search and the two pages read nothing new.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ME = 'bc1qmeaddressmeaddressmeaddressmeaddr00';
const OTHER = 'bc1qotheraddressotheraddressotheraddr11';

const ABI = {
    methods: {
        balance_of: { params: [{ name: 'who', type: 'string' }], summary: 'Read an account balance.', view: true },
        transfer: { params: [{ name: 'to', type: 'string' }, { name: 'amount', type: 'string' }], summary: 'Transfer vault shares.', view: false },
    },
};

const CALLS = [
    { action: 'EXECUTE', action_index: '10', block_index: '100', method_name: 'balance_of', status: 'valid', caller: OTHER, tx_hash: 'aa11' },
    { action: 'EXECUTE', action_index: '30', block_index: '300', method_name: 'transfer', status: 'valid', caller: ME, tx_hash: 'cc33' },
    { action: 'DEPOSIT', action_index: '20', block_index: '200', status: 'valid', caller: OTHER, tx_hash: 'bb22' },
];

function messagingFor(row, { executions = [], total = executions.length } = {}) {
    const target = {
        getAddressesByChain: vi.fn(() => Promise.resolve({ [CHAIN]: [{ address: ME }] })),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getContractByActionIndex: vi.fn(() => Promise.resolve({ data: row })),
        getActionByIndex: vi.fn(() => Promise.resolve({})),
        getContractState: vi.fn(() => Promise.resolve({ data: [{ state_key: 'paused', state_value: 'false' }] })),
        getContractBalance: vi.fn(() => Promise.resolve({ data: [{ tick: 'BTC', quantity: '0.015' }, { tick: 'XCHAIN', quantity: '1250' }] })),
        getExecutionsForContract: vi.fn(() => Promise.resolve({ data: executions, total })),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function drain() {
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

async function mount(props = {}, row = {}, data = {}) {
    const messaging = messagingFor({ action_index: '49', status: 'valid', meta_name: 'Pool', source: ME, ...row }, data);
    await domAct(async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContractDetail walletId="w" chainId={CHAIN} contractActionIndex="49" onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        await drain();
    });
    // Wrapped: the proxy answers every property, `then` included, so an async
    // function returning it bare would wait on it forever.
    return { messaging };
}

async function chooseTab(name) {
    await domAct(async () => {
        fireEvent.click(screen.getByRole('tab', { name }));
        await drain();
    });
}

async function search(text) {
    const trigger = screen.getByRole('button', { name: /^Search / });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    await domAct(async () => {
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
        await drain();
    });
}

function tabPanel() {
    return screen.getByRole('tabpanel');
}

afterEach(() => cleanup());

describe('ContractDetail layout 3', () => {
    it('shows three tabs, Actions first and chosen', async () => {
        await mount({ onExecute: vi.fn() });
        const tabs = within(screen.getByRole('tablist', { name: 'Contract sections' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'Activity']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(within(tabPanel()).getByRole('list', { name: 'Contract actions' }).tagName).toBe('UL');
    });

    it('opens with a white identity card and no chart', async () => {
        await mount({ onExecute: vi.fn() }, { abi: ABI, meta_description: 'A vault for the screen walk.' }, { executions: CALLS, total: 3 });
        const card = document.querySelector('[data-contract-identity]');
        expect(card).toBeTruthy();
        expect(card.textContent).toContain('Pool');
        expect(card.textContent).toContain('A vault for the screen walk.');
        expect(card.textContent).toContain('Holds 0.015 BTC and 1,250 XCHAIN');
        expect(card.textContent).toMatch(/Published by\s*you,\s*block/);
        expect(card.querySelector('[data-contract-calls]').textContent).toBe('3 calls');
        // No chart, no range chips, no separate What It Does card.
        expect(document.querySelector('[data-chart-behind]')).toBeNull();
        expect(document.querySelector('svg[role="img"]')).toBeNull();
        expect(screen.queryByRole('tablist', { name: /range/i })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'What It Does' })).toBeNull();
    });

    it('lists the standard actions, then the Contract Functions heading and a row per function', async () => {
        await mount({ onExecute: vi.fn(), onDeposit: vi.fn(), onWithdraw: vi.fn(), onStakeToContract: vi.fn() }, { abi: ABI, cooldown_blocks: 144 });
        const panel = tabPanel();
        const standard = within(within(panel).getByRole('list', { name: 'Contract actions' })).getAllByRole('button');
        expect(standard.map((row) => row.textContent.match(/^(Deposit|Withdraw|Stake here|View code|View state)/)?.[1]))
            .toEqual(['Deposit', 'Withdraw', 'Stake here', 'View code', 'View state']);
        const heading = within(panel).getByRole('heading', { name: 'Contract Functions' });
        const fnList = within(panel).getByRole('list', { name: 'Contract functions' });
        // The heading sits after the standard actions and before the function rows.
        expect(standard[standard.length - 1].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(heading.compareDocumentPosition(fnList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const fnRows = within(fnList).getAllByRole('button');
        expect(fnRows.map((row) => row.textContent.match(/^(balance_of|transfer|Call by name)/)?.[1]))
            .toEqual(['balance_of', 'transfer', 'Call by name']);
        expect(fnRows[0].textContent).toContain('Read only');
        expect(fnRows[1].textContent).toContain('Writes');
        // No Call method row and no Functions tab any more.
        expect(screen.queryByRole('button', { name: /^Call method/ })).toBeNull();
        expect(screen.queryByRole('tab', { name: /Functions/ })).toBeNull();
    });

    it('runs each handler from its row, and a function row opens its call form with that function', async () => {
        const onExecute = vi.fn();
        const onDeposit = vi.fn();
        const onWithdraw = vi.fn();
        const onStakeToContract = vi.fn();
        await mount({ onExecute, onDeposit, onWithdraw, onStakeToContract }, { abi: ABI, cooldown_blocks: 10 });
        const ref = { chainId: CHAIN, contractActionIndex: '49' };
        fireEvent.click(screen.getByRole('button', { name: /^Deposit/ }));
        expect(onDeposit).toHaveBeenCalledWith(ref);
        fireEvent.click(screen.getByRole('button', { name: /^Withdraw/ }));
        expect(onWithdraw).toHaveBeenCalledWith(ref);
        fireEvent.click(screen.getByRole('button', { name: /^Stake here/ }));
        expect(onStakeToContract).toHaveBeenCalledWith(ref);
        fireEvent.click(screen.getByRole('button', { name: /^balance_of/ }));
        expect(onExecute).toHaveBeenLastCalledWith({ ...ref, method: 'balance_of' });
        fireEvent.click(screen.getByRole('button', { name: /^Call by name/ }));
        expect(onExecute).toHaveBeenLastCalledWith(ref);
    });

    it('keeps a row without its handler as a dimmed row that does nothing', async () => {
        await mount({ onExecute: vi.fn() });
        expect(screen.getByRole('button', { name: /^Deposit/ }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: /^Call by name/ }).getAttribute('aria-disabled')).toBeNull();
        // Stake here shows only on a stakeable contract.
        expect(screen.queryByRole('button', { name: /^Stake here/ })).toBeNull();
    });

    it('carries no danger row: none of the contract actions is destructive', async () => {
        await mount({ onExecute: vi.fn(), onDeposit: vi.fn(), onWithdraw: vi.fn() }, { abi: ABI });
        expect(tabPanel().querySelector('[data-tone="danger"]')).toBeNull();
    });

    it('shows every call on Activity, newest first, with no mine filter', async () => {
        await mount({ onExecute: vi.fn() }, { abi: ABI }, { executions: CALLS, total: 3 });
        await chooseTab('Activity');
        const text = tabPanel().textContent;
        // Calls by this wallet and by others alike, deposits included.
        expect(text).toContain('transfer #30');
        expect(text).toContain('balance_of #10');
        expect(text).toMatch(/#20/);
        expect(text.indexOf('#30')).toBeLessThan(text.indexOf('#20'));
        expect(text.indexOf('#20')).toBeLessThan(text.indexOf('#10'));
        expect(screen.queryByRole('button', { name: /Only mine/i })).toBeNull();
        expect(screen.queryByText(/Your calls/)).toBeNull();
        expect(screen.queryByRole('tab', { name: /Mine/ })).toBeNull();
    });

    it('puts the facts on Details and View code and View state on Actions, each opening its own page', async () => {
        await mount({ onExecute: vi.fn() }, { abi: ABI, code_hash: 'feedc0de', gas_limit: 250000 });
        await chooseTab('Details');
        expect(screen.getByText('Owner (you)')).toBeTruthy();
        expect(screen.getByText('Gas limit')).toBeTruthy();
        expect(screen.queryByRole('tab', { name: /Code/ })).toBeNull();
        // Details carries no code or state buttons any more.
        expect(screen.queryByRole('button', { name: /^View code/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^(View )?state/i })).toBeNull();
        await chooseTab('Actions');
        const facts = within(tabPanel()).getByRole('list', { name: 'Contract actions' });

        await domAct(async () => {
            fireEvent.click(within(facts).getByRole('button', { name: /^View code/ }));
            await drain();
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Contract Code' })).toBeTruthy();
        expect(screen.getByText('feedc0de')).toBeTruthy();
        expect(screen.queryByRole('tablist', { name: 'Contract sections' })).toBeNull();
        await domAct(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Back to contract' }));
            await drain();
        });
        expect(screen.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');

        await domAct(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^View state/ }));
            await drain();
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Contract State' })).toBeTruthy();
        expect(screen.getByRole('table').textContent).toContain('paused');
    });

    it('reads each source once, and tabs, search and the two pages add no read', async () => {
        for (const executions of [CALLS.slice(0, 1), CALLS]) {
            cleanup();
            const { messaging } = await mount({ onExecute: vi.fn() }, { abi: ABI }, { executions });
            await chooseTab('Activity');
            await search('transfer');
            await chooseTab('Actions');
            await domAct(async () => {
                fireEvent.click(screen.getByRole('button', { name: /^View code/ }));
                await drain();
            });
            await domAct(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Back to contract' }));
                await drain();
            });
            await domAct(async () => {
                fireEvent.click(screen.getByRole('button', { name: /^View state/ }));
                await drain();
            });
            for (const getter of [
                'getContractByActionIndex',
                'getActionByIndex',
                'getContractState',
                'getContractBalance',
                'getExecutionsForContract',
                'getAddressesByChain',
            ]) {
                expect(messaging[getter], `${getter} at ${executions.length} rows`).toHaveBeenCalledTimes(1);
            }
        }
    });
});

describe('ContractDetail header search', () => {
    it('narrows Actions by name, keeping the Contract Functions heading only while a function matches', async () => {
        await mount({ onExecute: vi.fn(), onDeposit: vi.fn(), onWithdraw: vi.fn() }, { abi: ABI });
        await search('trans');
        expect(screen.queryByRole('button', { name: /^Deposit/ })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Contract Functions' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^transfer/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^balance_of/ })).toBeNull();

        await search('deposit');
        expect(screen.getByRole('button', { name: /^Deposit/ })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Contract Functions' })).toBeNull();

        await search('nothing-like-this');
        expect(screen.getByText('No matching actions')).toBeTruthy();
    });

    it('narrows Activity by function name, address or txid', async () => {
        await mount({ onExecute: vi.fn() }, { abi: ABI }, { executions: CALLS, total: 3 });
        await chooseTab('Activity');
        await search('balance');
        expect(tabPanel().textContent).toContain('balance_of #10');
        expect(tabPanel().textContent).not.toContain('#30');

        await search(ME.slice(0, 12));
        expect(tabPanel().textContent).toContain('transfer #30');
        expect(tabPanel().textContent).not.toContain('#10');

        await search('bb22');
        expect(tabPanel().textContent).toMatch(/#20/);
        expect(tabPanel().textContent).not.toContain('#30');

        await search('zzzz');
        expect(screen.getByText('No matching activity')).toBeTruthy();
    });

    it('never matches a caller or txid the explorer hides behind a placeholder', async () => {
        const hidden = [{ action: 'EXECUTE', action_index: '40', block_index: '400', method_name: 'ping', status: 'valid', caller: '[obfuscated]', tx_hash: '[obfuscated]' }];
        await mount({ onExecute: vi.fn() }, {}, { executions: hidden, total: 1 });
        await chooseTab('Activity');
        await search('obfusc');
        expect(screen.getByText('No matching activity')).toBeTruthy();
        expect(tabPanel().textContent).not.toContain('[obfuscated]');
    });

    it('shows no call count on the card when the history read fails', async () => {
        const failing = messagingFor({ action_index: '49', status: 'valid', meta_name: 'Pool' });
        failing.getExecutionsForContract.mockImplementation(() => Promise.reject(new Error('down')));
        await domAct(async () => {
            render(
                <MessagingProvider shell="web" messaging={failing}>
                    <ContractDetail walletId="w" chainId={CHAIN} contractActionIndex="49" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        const card = document.querySelector('[data-contract-identity]');
        expect(card).toBeTruthy();
        expect(card.querySelector('[data-contract-calls]')).toBeNull();
        expect(card.textContent).not.toMatch(/\b0 calls\b/);
    });

    it('narrows Details by fact label, and a new tab starts with an empty search', async () => {
        await mount({ onExecute: vi.fn() }, { abi: ABI, gas_limit: 250000 });
        await chooseTab('Details');
        await search('gas');
        const panel = tabPanel();
        expect(within(panel).queryByRole('button', { name: /^View state/ })).toBeNull();
        expect(within(panel).getByText('Gas limit')).toBeTruthy();
        expect(within(panel).queryByText('Status')).toBeNull();
        expect(within(panel).queryByRole('button', { name: /^View code/ })).toBeNull();

        await chooseTab('Actions');
        expect(screen.getByRole('button', { name: /^Deposit/ })).toBeTruthy();
    });

    it('labels the search for the tab on screen', async () => {
        await mount({ onExecute: vi.fn() });
        expect(screen.getByRole('button', { name: 'Search actions' })).toBeTruthy();
        await chooseTab('Activity');
        expect(screen.getByRole('button', { name: 'Search activity' })).toBeTruthy();
        await chooseTab('Details');
        expect(screen.getByRole('button', { name: 'Search details' })).toBeTruthy();
    });
});
