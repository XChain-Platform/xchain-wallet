// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Watcher mode must say why the betting controls are gone.
//
// Found by driving the §10.5 gating leg (wallet E2E session 24). Flipping the
// wallet to watcher mode correctly removes Resolve, Cancel and the place-bet
// form - the security property holds, and the buttons are absent from the DOM
// rather than merely disabled. Nothing then explains the absence: a market
// still labelled "Taking bets" simply has no way to bet on it, and an oracle's
// own console offers no way to finish a market it opened. Neither page
// mentions watcher mode at all.
//
// Silence is the defect, not the hiding. Watcher is a first-class lane here
// (34 forms render "Create unsigned transaction" for it), and betting's own
// CreateBetFeedForm already refuses in plain words. The cost of not knowing is
// real on the oracle side: an unresolved market refunds every bet at expiry
// and earns the oracle nothing, so an oracle who cannot tell "restricted" from
// "broken" loses the market by waiting.
//
// The negative half matters as much: a market nobody can act on any more must
// NOT be annotated, or every terminal card grows a line blaming watcher mode
// for a restriction that is not watcher mode's.

import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
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
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betFeed: () => Promise.resolve({ data: [detail] }),
        betFeeds: ({ chainId }) => Promise.resolve({ data: chainId === CHAIN ? feeds : [] }),
        bets: () => Promise.resolve({ data: [] }),
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
    it('explains the missing stake form instead of leaving a "Taking bets" market blank', async () => {
        const utils = await renderRoute(harness({ walletMode: 'watcher' }), detailRoute);
        const text = utils.container.textContent;

        expect(text).not.toContain('Place a bet');
        expect(text).toContain('watcher mode');
        expect(text).toContain('cannot place a bet');
    });

    it('still offers the form, and says nothing about watcher mode, in full mode', async () => {
        const utils = await renderRoute(harness({ walletMode: 'full' }), detailRoute);
        const text = utils.container.textContent;

        expect(text).toContain('Place a bet');
        expect(text).not.toContain('watcher mode');
    });

    // The reason has to track the actual restriction. A closed market takes no
    // bets from anyone, so watcher mode is not why the form is missing there.
    it('does not blame watcher mode on a market that takes no bets at all', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'watcher', detail: feed('closed') }),
            detailRoute,
        );
        expect(utils.container.textContent).not.toContain('watcher mode');
    });
});

describe('OracleConsole in watcher mode', () => {
    function cardFor(utils, index) {
        return Array.from(utils.container.querySelectorAll('div'))
            .filter((d) => /card/i.test(String(d.className)) && /^#\d+/.test(d.textContent || ''))
            .find((d) => new RegExp(`#${index}`).test(d.textContent));
    }

    it('hides Resolve and Cancel and says why', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'watcher', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const card = cardFor(utils, '1193');

        expect(card.textContent).not.toContain('Resolve');
        expect(card.textContent).not.toContain('Cancel and refund');
        expect(card.textContent).toContain('watcher mode');
        expect(card.textContent).toContain('cannot resolve or cancel');
        // Hidden, not merely disabled: a disabled button is still a promise.
        const labels = Array.from(card.querySelectorAll('button')).map((b) => b.textContent.trim());
        expect(labels).not.toContain('Resolve');
    });

    it('offers both, and no explanation, in full mode', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'full', feeds: [feed('closed')] }),
            consoleRoute,
        );
        const card = cardFor(utils, '1193');

        expect(card.textContent).toContain('Resolve');
        expect(card.textContent).toContain('Cancel and refund');
        expect(card.textContent).not.toContain('watcher mode');
    });

    // A cancelled or resolved market offers nothing to anybody. Annotating it
    // would tell a watcher its mode cost it an action that no mode has.
    it('stays quiet on a terminal market, where no wallet mode could act', async () => {
        const utils = await renderRoute(
            harness({ walletMode: 'watcher', feeds: [feed('cancelled')] }),
            consoleRoute,
        );
        expect(cardFor(utils, '1193').textContent).not.toContain('watcher mode');
    });
});
