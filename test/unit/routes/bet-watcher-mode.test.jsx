// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Watcher mode keeps BET mutations available as unsigned PSBT builds and never
// renders a software-signing password field.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
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
    const target = {
        calls,
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode }),
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

const detailRoute = React.createElement(BetFeedDetail, {
    walletId: 'w', chainId: CHAIN, feedIndex: '1193', onBack() {},
});
const consoleRoute = React.createElement(OracleConsole, { walletId: 'w', onBack() {} });

describe('BetFeedDetail in watcher mode', () => {
    it('offers an unsigned stake build without a password field', async () => {
        const messaging = harness({ walletMode: 'watcher' });
        const utils = await renderRoute(messaging, detailRoute);
        const text = utils.container.textContent;

        expect(text).toContain('Place a bet');
        expect(text).toContain('Create unsigned transaction');
        expect(utils.queryByLabelText('Password')).toBeNull();

        fireEvent.click(utils.getByRole('group', { name: 'Outcome to back' }).querySelector('button'));
        fireEvent.change(utils.getByLabelText('Stake (XCHAIN)'), { target: { value: '1' } });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' }));
            await drain();
        });
        expect(messaging.calls[0]).toMatchObject({
            builder: 'placeBetParams',
            params: { feedActionIndex: '1193', outcome: 0, amount: '1' },
        });
        expect(utils.getByLabelText('Unsigned transaction hex')).toBeTruthy();
        expect(utils.queryByLabelText('Password')).toBeNull();
    });

    it('still offers the signing form in full mode', async () => {
        const utils = await renderRoute(harness({ walletMode: 'full' }), detailRoute);
        const text = utils.container.textContent;

        expect(text).toContain('Place a bet');
        expect(utils.getByLabelText('Password')).toBeTruthy();
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
    function cardFor(utils, index) {
        return Array.from(utils.container.querySelectorAll('div'))
            .filter((d) => /card/i.test(String(d.className)) && /^#\d+/.test(d.textContent || ''))
            .find((d) => new RegExp(`#${index}`).test(d.textContent));
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
        expect(labels).toContain('Resolve');

        fireEvent.click(Array.from(card.querySelectorAll('button')).find((b) => b.textContent.trim() === action));
        if (needsOutcome) fireEvent.click(utils.getByRole('button', { name: 'Yes' }));
        expect(utils.queryByLabelText('Password')).toBeNull();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' }));
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
        expect(utils.getByLabelText('Unsigned transaction hex')).toBeTruthy();
    });

    it('offers both, and no explanation, in full mode', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'full', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const card = cardFor(utils, '1193');

        expect(card.textContent).toContain('Resolve');
        expect(card.textContent).toContain('Cancel and refund');
        expect(card.textContent).not.toContain('Create unsigned transaction');
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
        const picker = utils.container.querySelector('[aria-label="Outcome to back"]');
        await assertGroup(picker, ['Yes', 'No']);
    });

    it('marks the winning outcome pressed on the resolve picker', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'full', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const resolve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => b.textContent.trim() === 'Resolve');
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
