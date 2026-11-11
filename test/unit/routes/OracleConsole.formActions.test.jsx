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

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

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
    };
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); } });
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openForm(status, rowButton) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingFor(status) },
            React.createElement(OracleConsole, { walletId: 'w', onBack() {}, onOpenMarket() {}, onDuplicate() {} }),
        ));
        await drain();
    });
    await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: rowButton })); await drain(); });
    return utils;
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
    it('edit lists: green Update lists with an icon, help tips on both list fields, no hint paragraph', async () => {
        const utils = await openForm('open', 'Edit lists');
        const main = utils.getByRole('button', { name: 'Update lists' });
        expect(isSuccess(main)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(utils.queryByText(/Leave a field blank/)).toBeNull();
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        expect(tips.some((t) => /may bet/.test(t))).toBe(true);
        expect(tips.some((t) => /may not bet/.test(t))).toBe(true);
        expect(utils.queryByRole('button', { name: 'Review list edit' })).toBeNull();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(1);
        expectEveryButtonHasIcon(utils);
    });

    it('resolve: green Publish result with an icon, the warning in the question tip, outcome toggles with icons', async () => {
        const utils = await openForm('closed', 'Resolve');
        const main = utils.getByRole('button', { name: 'Publish result' });
        expect(isSuccess(main)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Yes' }).querySelector('svg')).toBeTruthy();
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        expect(tips.some((t) => /cannot be undone/.test(t))).toBe(true);
        expect([...utils.container.querySelectorAll('p')].some((p) => /This pays the market out/.test(p.textContent))).toBe(false);
        expect(utils.queryByRole('button', { name: 'Review resolve' })).toBeNull();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(1);
        expectEveryButtonHasIcon(utils);
    });

    it('cancel: Cancel market stays the danger action with an icon and no green button shows', async () => {
        const utils = await openForm('closed', 'Cancel and refund');
        const main = utils.getByRole('button', { name: 'Cancel market' });
        expect(/danger/.test(main.className)).toBe(true);
        expect(main.querySelector('svg')).toBeTruthy();
        expect([...utils.container.querySelectorAll('button')].filter(isSuccess)).toHaveLength(0);
        expectEveryButtonHasIcon(utils);
    });
});
