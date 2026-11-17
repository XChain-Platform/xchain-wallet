// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Watcher mode keeps BET mutations available as unsigned PSBT builds and never
// renders a software-signing password field.

import { describe, it, expect, afterEach } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { selectOption } from '../../helpers/selectOption.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

afterEach(() => { resetWalletModes(); });
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const now = () => Math.floor(Date.now() / 1000);

// `open` markets are the only ones that take a bet; `closed` inside the refund
// window is the only state where an oracle may both resolve and cancel. Those
// are the two states where a hidden control needs a reason.
function feed(status, extra = {}) {
    return {
        action_index: '1193',
        source: ORACLE,
        label: 'Nobody resolves this, so the chain must refund everyone',
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        fee: '5',
        deadline: status === 'open' ? now() + 3600 : now() - 600,
        expire_at: now() + 3600,
        feed_status: status,
        pools: [{ outcome: 0, pool: '400.000000000000000000', bet_count: 1 }],
        timeline: [{ status: 'open', block_index: 2255 }],
        chainId: CHAIN,
        ...extra,
    };
}

function harness({ walletMode = 'full', feeds = [], detail = feed('open') } = {}) {
    const calls = [];
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const target = {
        calls,
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode }]),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betFeed: () => Promise.resolve({ data: [detail] }),
        betFeeds: ({ chainId }) => Promise.resolve({ data: chainId === CHAIN ? feeds : [] }),
        bets: () => Promise.resolve({ data: [] }),
        buildBetActionPsbtRequest: (args) => {
            calls.push(args);
            return Promise.resolve({
                psbtHex: '70736274ff00', chainId: CHAIN, fromAddress: OWN, encoding: 'op_return',
            });
        },
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

async function renderRoute(messaging, element) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(MessagingProvider, { shell: 'web', messaging }, element),
        );
        await drain();
    });
    return utils;
}

// The market page opens on Details; only the chosen tab renders, so the bet
// form shows after the Bet tab is picked.
async function openBetTab(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('tab', { name: 'Bet' }));
        await drain();
    });
}

const detailRoute = React.createElement(BetFeedDetail, {
    walletId: 'w', chainId: CHAIN, feedIndex: '1193', onBack() {},
});
const consoleRoute = React.createElement(OracleConsole, { walletId: 'w', onBack() {} });

describe('BetFeedDetail in watcher mode', () => {
    it('offers an unsigned stake build without a password field', async () => {
        const messaging = harness({ walletMode: 'watcher' });
        const utils = await renderRoute(messaging, detailRoute);
        await openBetTab(utils);
        fireEvent.click(utils.getByRole('list', { name: 'Outcome to back' }).querySelector('button'));
        // Bet opens the Place Bet step, whose action builds the unsigned stake.
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Bet' }));
            await drain();
        });
        expect(utils.getByRole('form', { name: 'Place Bet' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Create Unsigned Transaction' })).toBeTruthy();
        expect(utils.queryByLabelText('Password')).toBeNull();

        fireEvent.change(utils.getByLabelText('Stake (XCHAIN)'), { target: { value: '1' } });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create Unsigned Transaction' }));
            await drain();
        });
        expect(messaging.calls[0]).toMatchObject({
            builder: 'placeBetParams',
            params: { feedActionIndex: '1193', outcome: 0, amount: '1' },
        });
        expect(utils.getByLabelText('Unsigned transaction code')).toBeTruthy();
        expect(utils.queryByLabelText('Password')).toBeNull();
    });

    it('still offers the signing form in full mode', async () => {
        const utils = await renderRoute(harness({ walletMode: 'full' }), detailRoute);
        await openBetTab(utils);
        fireEvent.click(utils.getByRole('list', { name: 'Outcome to back' }).querySelector('button'));
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Bet' }));
            await drain();
        });

        // The Place Bet step signs; the shared confirm screen asks for the
        // password, so the form itself carries none.
        expect(utils.getByRole('form', { name: 'Place Bet' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Place Bet' })).toBeTruthy();
        expect(utils.queryByRole('button', { name: 'Create Unsigned Transaction' })).toBeNull();
        expect(utils.queryByLabelText('Password')).toBeNull();
    });

    it('does not offer a password on a closed market', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'watcher', detail: feed('closed') }),
            detailRoute,
        );
        expect(utils.queryByLabelText('Password')).toBeNull();
    });
});

describe('OracleConsole in watcher mode', () => {
    // One market: its card, then its action list (G101) and any open form.
    function cardFor(utils, index) {
        return Array.from(utils.container.querySelectorAll('[data-oracle-market]'))
            .find((d) => d.getAttribute('data-oracle-market').endsWith(`:${index}`));
    }

    it.each([
        ['Resolve', 'resolveMarketParams', true],
        ['Cancel and refund', 'cancelMarketParams', false],
    ])('builds an unsigned %s action without a password field', async (action, builder, needsOutcome) => {
        const messaging = harness({ walletMode: 'watcher', feeds: [feed('closed')] });
        const utils = await renderRoute(
            messaging,
            consoleRoute,
        );
        const card = cardFor(utils, '1193');

        expect(card.textContent).toContain('Resolve');
        expect(card.textContent).toContain('Cancel and refund');
        const labels = Array.from(card.querySelectorAll('button')).map((b) => b.textContent.trim());
        expect(labels.some((label) => label.startsWith('Resolve'))).toBe(true);

        fireEvent.click(Array.from(card.querySelectorAll('button')).find((b) => b.textContent.trim().startsWith(action)));
        if (needsOutcome) fireEvent.click(utils.getByRole('button', { name: 'Yes' }));
        expect(utils.queryByLabelText('Password')).toBeNull();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create Unsigned Transaction' }));
            await drain();
        });
        expect(messaging.calls[0]).toMatchObject({
            builder,
            params: {
                feedActionIndex: '1193',
                ...(needsOutcome ? { outcome: 0 } : {}),
            },
        });
        expect(utils.queryByLabelText('Password')).toBeNull();
        expect(utils.getByLabelText('Unsigned transaction code')).toBeTruthy();
    });

    it('offers both, and no explanation, in full mode', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'full', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const card = cardFor(utils, '1193');

        expect(card.textContent).toContain('Resolve');
        expect(card.textContent).toContain('Cancel and refund');
        expect(card.textContent).not.toContain('Create Unsigned Transaction');
    });

    it('offers no password on a terminal market', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'watcher', feeds: [feed('cancelled')] }),
            consoleRoute,
        );
        expect(utils.queryByLabelText('Password')).toBeNull();
    });
});

// The outcome pickers announce which side is selected.
//
// Both betting surfaces signalled the selected outcome with the button's
// background colour and nothing else: no aria-pressed, no aria-selected, no
// role, no text change. A screen reader announced two identical "Yes" / "No"
// buttons with no selected state, on the two controls in this wallet that
// decide where money goes - which side of a bet a stake backs, and which
// outcome an oracle pays the whole pot out to. The second cannot be undone.
describe('betting outcome pickers announce the selected outcome', () => {
    it('marks the backed outcome pressed on the place-bet picker', async () => {
        const utils = await renderRoute(harness({ walletMode: 'full' }), detailRoute);
        await openBetTab(utils);
        // The Bet tab's outcome rows are actions, not a selection: tapping
        // No opens Place Bet, whose outcome dropdown shows No.
        const outcomeButtons = Array.from(utils.container.querySelectorAll('[data-outcome-list] button'));
        expect(outcomeButtons.map((b) => b.getAttribute('aria-label').split(',')[0])).toEqual(['Bet on Yes', 'Bet on No']);
        for (const b of outcomeButtons) expect(b.hasAttribute('aria-pressed')).toBe(false);
        await domAct(async () => { outcomeButtons[1].click(); await drain(); });
        const picker = () => utils.container.querySelector('form button[aria-label^="Outcome: "]');
        expect(picker()).not.toBeNull();
        expect(picker().getAttribute('aria-label')).toBe('Outcome: No');
        await domAct(async () => { selectOption(picker(), { value: '0' }); await drain(); });
        expect(picker().getAttribute('aria-label')).toBe('Outcome: Yes');
    });

    it('marks the winning outcome pressed on the resolve picker', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'full', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const resolve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => b.textContent.trim().startsWith('Resolve'));
        await domAct(async () => { resolve.click(); await drain(); });
        await assertGroup(utils.container.querySelector('[aria-label="Winning outcome"]'), ['Yes', 'No']);
    });

    // Selection is state, not decoration: every option must carry aria-pressed,
    // exactly one may be true after a click, and none before.
    async function assertGroup(group, labels) {
        expect(group).not.toBeNull();
        const buttons = Array.from(group.querySelectorAll('button'));
        expect(buttons.map((b) => b.textContent.trim())).toEqual(labels);
        for (const b of buttons) expect(b.getAttribute('aria-pressed')).toBe('false');

        await domAct(async () => { buttons[1].click(); await drain(); });
        const after = Array.from(group.querySelectorAll('button'));
        expect(after.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
        expect(after[1].getAttribute('aria-pressed')).toBe('true');
    }
});
