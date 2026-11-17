// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The markets console's inline forms follow the form rulings: each step's
// main action names what it does and carries an icon, the list edit and the
// result are the one green action, cancel stays the danger action, field
// explanations live in help tips, and every button carries an icon.

import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ actionIndex: '81', name: 'Pickers' })}>
            Pick {title}
        </button>
    ),
}));
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const now = () => Math.floor(Date.now() / 1000);

function feed(status) {
    return {
        action_index: '1193', source: OWN, label: 'Rain in the city on the deadline', outcomes: 'Yes,No', tick: 'XCHAIN', fee: '5',
        deadline: status === 'open' ? now() + 3600 : now() - 600, expire_at: now() + 3600, feed_status: status, chainId: CHAIN,
    };
}

function messagingFor(status) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        betFeeds: ({ chainId }) => Promise.resolve({ data: chainId === CHAIN ? [feed(status)] : [] }),
        composeForConfirm: vi.fn(),
        composeBetForConfirm: vi.fn(() => new Promise(() => {})),
    };
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); } });
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openForm(status, rowButton) {
    let utils;
    const messaging = messagingFor(status);
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OracleConsole, { walletId: 'w', onBack() {}, onOpenMarket() {}, onDuplicate() {} }),
        ));
        await drain();
    });
    await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: rowButton })); await drain(); });
    return Object.assign(utils, { messaging });
}

const isSuccess = (b) => /success/.test(b.className);

function expectEveryButtonHasIcon(utils) {
    for (const b of utils.container.querySelectorAll('main button, button')) {
        if (b.getAttribute('aria-label') && /more info/i.test(b.getAttribute('aria-label'))) continue;
        if (b.closest('[class*="wrap"]') && b.getAttribute('aria-describedby') && !b.textContent.replace('?', '').trim()) continue;
        expect(b.querySelector('svg'), `button "${b.textContent.trim()}" has an icon`).toBeTruthy();
    }
}

describe('OracleConsole inline form actions', () => {
    it('edit lists: green Update Lists with an icon, help tips on both list fields, no hint paragraph', async () => {
        const utils = await openForm('open', /^Edit lists/);
        const main = utils.getByRole('button', { name: 'Update Lists' });
        expect(isSuccess(main)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(utils.queryByText(/Leave a field blank/)).toBeNull();
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        expect(tips.some((t) => /may buy positions/.test(t))).toBe(true);
        expect(tips.some((t) => /may not buy positions/.test(t))).toBe(true);
        expect(utils.queryByRole('button', { name: 'Review list edit' })).toBeNull();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(1);
        expect(main).toBeEnabled();
        fireEvent.click(main);
        expect(utils.getByLabelText('Form errors')).toHaveTextContent('Choose an allow-list or block-list change.');
        expect(utils.messaging.composeForConfirm).not.toHaveBeenCalled();
        expectEveryButtonHasIcon(utils);
    });

    it('resolve: green Publish Result with an icon, field help in the question tip, outcome toggles with icons', async () => {
        const utils = await openForm('closed', /^Resolve/);
        const main = utils.getByRole('button', { name: 'Publish Result' });
        expect(isSuccess(main)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Yes' }).querySelector('svg')).toBeTruthy();
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        // The tip is field help; the payout warning is the confirm screen's
        // warnings card (actionWarnings MARKET_RESOLVE), not form text.
        expect(tips.some((t) => /The outcome that really happened/.test(t))).toBe(true);
        expect(tips.some((t) => /cannot be undone/.test(t))).toBe(false);
        expect(utils.container.textContent).not.toMatch(/pays the market out|This pays out the market/);
        expect(utils.queryByRole('button', { name: 'Review resolve' })).toBeNull();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(1);
        expect(main).toBeEnabled();
        fireEvent.click(main);
        expect(utils.getByLabelText('Form errors')).toHaveTextContent('Choose the winning outcome.');
        expect(utils.messaging.composeForConfirm).not.toHaveBeenCalled();
        expectEveryButtonHasIcon(utils);
    });

    it('resolve forwards a selected Fast fee rate to the transaction compose', async () => {
        const utils = await openForm('closed', /^Resolve/);
        fireEvent.click(utils.getByRole('button', { name: 'Yes' }));
        fireEvent.click(utils.container.querySelector('button[aria-label="Fast"]'));
        expect(utils.getByRole('slider', { name: 'Network fee' })).toHaveAttribute(
            'aria-valuetext', expect.stringMatching(/^Fast: /),
        );
        fireEvent.click(utils.getByRole('button', { name: 'Publish Result' }));
        expect(utils.messaging.composeBetForConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ builder: 'resolveMarketParams', feePerKb: 12_000 }),
        );
    });

    it('cancel: Cancel Market stays the danger action with an icon and no green button shows', async () => {
        const utils = await openForm('closed', /^Cancel and refund/);
        const main = utils.getByRole('button', { name: 'Cancel Market' });
        expect(/danger/.test(main.className)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(0);
        expectEveryButtonHasIcon(utils);
        // The refund line is the confirm screen's warnings card, not form text.
        expect(utils.queryByTestId('confirm-action-warnings')).toBeNull();
        expect(utils.container.textContent).not.toMatch(/refunded in full/);
    });

    it('cancel in a watcher wallet, which has no confirm screen, shows the warnings card on the form', async () => {
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        try {
            const utils = await openForm('closed', /^Cancel and refund/);
            // The kind's title says it is final; the line says what happens.
            expect(utils.getByTestId('confirm-action-warnings')).toHaveTextContent(
                "You can't undo this",
            );
            expect(utils.getByTestId('confirm-action-warnings')).toHaveTextContent(
                'Every open position is refunded in full and the market ends.',
            );
        } finally {
            resetWalletModes();
        }
    });
});

// Each market's actions are one ActionList under its card (G101): view, the
// result, cancel in the danger tone, the lists, then the copy, every row
// still running its own handler.
describe('OracleConsole market action list', () => {
    async function mountConsole(status, props) {
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: messagingFor(status) },
                React.createElement(OracleConsole, { walletId: 'w', onBack() {}, ...props }),
            ));
            await drain();
        });
        return utils;
    }
    const titles = (list) => within(list).getAllByRole('button')
        .map((b) => b.querySelector('[data-tone]:not([aria-hidden])').textContent.trim());

    it('draws a closed market\'s actions as one list, Cancel and refund in the danger tone', async () => {
        const onOpenMarket = vi.fn();
        const onDuplicate = vi.fn();
        const utils = await mountConsole('closed', { onOpenMarket, onDuplicate });
        const list = utils.getByRole('list', { name: 'Market #1193 actions' });
        expect(titles(list)).toEqual(['View market', 'Resolve', 'Cancel and refund', 'Copy to a new market']);
        // No sized ghost, danger or primary buttons are left on the card.
        expect(utils.queryByRole('button', { name: 'View Market' })).toBeNull();
        expect(within(list).getByRole('button', { name: /^Cancel and refund/ }).getAttribute('data-tone')).toBe('danger');
        expect(within(list).getByRole('button', { name: /^Resolve/ }).getAttribute('data-tone')).toBe('default');

        fireEvent.click(within(list).getByRole('button', { name: /^View market/ }));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, '1193');
        fireEvent.click(within(list).getByRole('button', { name: /^Copy to a new market/ }));
        expect(onDuplicate).toHaveBeenCalledWith(CHAIN, '1193');

        const resolve = within(list).getByRole('button', { name: /^Resolve/ });
        expect(resolve.getAttribute('aria-expanded')).toBe('false');
        await domAct(async () => { fireEvent.click(resolve); await drain(); });
        expect(within(list).getByRole('button', { name: /^Resolve/ }).getAttribute('aria-expanded')).toBe('true');
        expect(utils.getByRole('group', { name: 'Winning outcome' })).toBeTruthy();
    });

    it('offers Edit lists on an open market and opens its list editor', async () => {
        const utils = await mountConsole('open', {});
        const list = utils.getByRole('list', { name: 'Market #1193 actions' });
        expect(titles(list)).toEqual(['Cancel and refund', 'Edit lists']);
        await domAct(async () => { fireEvent.click(within(list).getByRole('button', { name: /^Edit lists/ })); await drain(); });
        // Picker fields (G114): empty reads "None set"; a pick shows the list's name.
        expect(utils.getByRole('button', { name: 'Allow list: None set' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Block list: None set' })).toBeTruthy();
        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Allow list: None set' })); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Pick Choose Allow-List' })); await drain(); });
        expect(utils.getByRole('button', { name: 'Allow list: Pickers (List #81)' })).toBeTruthy();
        // Clearing the pick returns to the empty state.
        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Clear allow list' })); await drain(); });
        expect(utils.getByRole('button', { name: 'Allow list: None set' })).toBeTruthy();
    });
});
