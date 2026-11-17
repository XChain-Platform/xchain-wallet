// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The oracle's own actions moved off the My markets cards onto the market
// page (operator ruling 2026-11-13): an Actions tab, shown only to the
// address that runs the market, first in the tab row and chosen on open
// (G102), holding one ActionList (G101): Post result first, then Cancel and
// refund in the danger tone, Edit lists and Copy to a new market. Each is
// offered only where the oracle console's legality rules say the chain
// would accept it, and each still opens its form and the confirm page.

import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { oracleActionLegality } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const now = () => Math.floor(Date.now() / 1000);

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function feed(status, extra = {}) {
    return {
        action_index: '2343',
        source: OWN,
        label: 'Rain tomorrow?',
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        fee: '5',
        deadline: now() - 60,
        expire_at: now() + 86400,
        feed_status: status,
        pools: [],
        ...extra,
    };
}

function harness(market) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        composeBetForConfirm: (args) => {
            calls.push({ method: 'composeBetForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00', encoding: 'psbt', actionString: 'BET|3|x', version: 3,
                betParams: { version: 3, ...(args?.params || {}) },
            });
        },
        resolveMarketAction: (args) => {
            calls.push({ method: 'resolveMarketAction', args });
            return Promise.resolve({ txid: 'f00dface' });
        },
        cancelMarketAction: (args) => {
            calls.push({ method: 'cancelMarketAction', args });
            return Promise.resolve({ txid: 'dec0ded1' });
        },
        betFeed: () => Promise.resolve({ data: [market] }),
        bets: () => Promise.resolve({ data: [] }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openMarket(market, props = {}) {
    const { messaging, calls } = harness(market);
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedDetail walletId="w" chainId={CHAIN} feedIndex="2343" onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        await drain();
    });
    return { utils, calls };
}

// The owner's panel, read without a click: Actions is the first tab and
// opens chosen (G102). The click is kept so a later pick still reaches it.
async function openActions(utils) {
    await domAct(async () => { fireEvent.click(utils.getByRole('tab', { name: 'Actions' })); await drain(); });
    return utils.container.querySelector('[data-outcome-owner-actions]');
}

const actionList = (panel) => within(panel).getByRole('list', { name: 'Market actions' });

// Each row's title, the text before its description.
const rowTitles = (panel) => {
    const list = panel.querySelector('[data-outcome-owner-list]');
    return list
        ? within(list).getAllByRole('button').map((b) => b.querySelector('[data-tone]:not([aria-hidden])').textContent.trim())
        : [];
};

describe('BetFeedDetail owner Actions tab', () => {
    it('is not shown to a wallet that does not run the market, whose first tab stays Result', async () => {
        const { utils } = await openMarket(feed('closed', { source: ORACLE }), { onDuplicate: vi.fn() });
        expect(utils.queryByRole('tab', { name: 'Actions' })).toBeNull();
        expect(utils.queryByRole('button', { name: /^Post result/ })).toBeNull();
        expect(utils.queryByRole('button', { name: /^Cancel and refund/ })).toBeNull();
        const tabs = utils.getAllByRole('tab');
        expect(tabs[0].textContent).toContain('Result');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('keeps Bet first and chosen for a wallet that does not run an open market', async () => {
        const { utils } = await openMarket(feed('open', { source: ORACLE, deadline: now() + 3600 }));
        const tabs = utils.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['Bet', 'Activity', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('puts Actions first and chosen for the owner, before Bet, Activity and Details', async () => {
        const { utils } = await openMarket(feed('open', { deadline: now() + 3600 }));
        const tabs = utils.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['Actions', 'Bet', 'Activity', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        // The panel shown on open is the owner's action list.
        const panel = utils.container.querySelector('[data-outcome-owner-actions]');
        expect(actionList(panel)).toBeTruthy();
    });

    it('lists Post result first inside the result window, then Cancel and refund in the danger tone, then Copy', async () => {
        const { utils } = await openMarket(feed('closed'), { onDuplicate: vi.fn() });
        const panel = await openActions(utils);

        expect(actionList(panel)).toBeTruthy();
        expect(rowTitles(panel)).toEqual(['Post result', 'Cancel and refund', 'Copy to a new market']);
        const post = within(panel).getByRole('button', { name: /^Post result/ });
        expect(post.querySelector('svg')).not.toBeNull();
        expect(post.textContent).toContain('Publish the winning outcome');
        expect(post.getAttribute('data-tone')).toBe('default');
        const cancel = within(panel).getByRole('button', { name: /^Cancel and refund/ });
        expect(cancel.getAttribute('data-tone')).toBe('danger');
        // No separate green main button is left on the tab.
        expect(panel.querySelector('button[class*="success"]')).toBeNull();
        // The refund timing is a WarningCard line on this tab, not a loose line.
        const timing = panel.querySelector('[data-bet-owner-timing]');
        expect(timing.textContent).toMatch(/Waiting for your result; refunds everyone in .* if unresolved/);
    });

    it('offers no Post result once the refund window has ended, only Cancel', async () => {
        const { utils } = await openMarket(feed('closed', { expire_at: now() - 60 }));
        const panel = await openActions(utils);
        expect(within(panel).queryByRole('button', { name: /^Post result/ })).toBeNull();
        expect(rowTitles(panel)).toEqual(['Cancel and refund']);
        expect(panel.textContent).toContain('the refund window has ended');
    });

    it('offers Cancel and Edit lists while the market takes bets, never Post result', async () => {
        const { utils } = await openMarket(feed('open', { deadline: now() + 3600 }));
        const panel = await openActions(utils);
        expect(within(panel).queryByRole('button', { name: /^Post result/ })).toBeNull();
        expect(rowTitles(panel)).toEqual(['Cancel and refund', 'Edit lists']);
        const edit = within(panel).getByRole('button', { name: /^Edit lists/ });
        expect(edit.getAttribute('aria-expanded')).toBe('false');
        await domAct(async () => { fireEvent.click(edit); await drain(); });
        expect(within(panel).getByRole('button', { name: /^Edit lists/ }).getAttribute('aria-expanded')).toBe('true');
        // The editor's fields are list pickers (G114); empty reads "None set".
        expect(utils.getByRole('button', { name: 'Allow list: None set' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Block list: None set' })).toBeTruthy();
    });

    it('leaves a terminal market only Copy to a new market, and no tab without it', async () => {
        const onDuplicate = vi.fn();
        const { utils } = await openMarket(feed('resolved', { winning_outcome: 0 }), { onDuplicate });
        const panel = await openActions(utils);
        expect(rowTitles(panel)).toEqual(['Copy to a new market']);
        expect(panel.querySelector('[data-bet-owner-timing]')).toBeNull();
        fireEvent.click(within(panel).getByRole('button', { name: /^Copy to a new market/ }));
        expect(onDuplicate).toHaveBeenCalledWith(CHAIN, '2343');
        utils.unmount();

        const again = await openMarket(feed('resolved', { winning_outcome: 0 }));
        expect(again.utils.queryByRole('tab', { name: 'Actions' })).toBeNull();
    });

    it('keeps the resolve form and confirm page, and reports the published result', async () => {
        const { utils, calls } = await openMarket(feed('closed'));
        const panel = await openActions(utils);

        await domAct(async () => { fireEvent.click(within(panel).getByRole('button', { name: /^Post result/ })); await drain(); });
        const outcomes = utils.getByRole('group', { name: 'Winning outcome' });
        await domAct(async () => { fireEvent.click(within(outcomes).getByRole('button', { name: 'Yes' })); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Publish Result' })); await drain(); });
        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose.args.builder).toBe('resolveMarketParams');
        // Signed from the address that runs the market.
        expect(compose.args.from.address).toBe(OWN);
        await domAct(async () => { fireEvent.click(utils.getByTestId('confirm-approve')); await drain(); });

        expect(calls.some((c) => c.method === 'resolveMarketAction')).toBe(true);
        const receipt = utils.getByTestId('oracle-result');
        expect(receipt.textContent).toContain('f00dface');
    });

    it('answers a demo owner pressing Publish Result with the refusal, composing nothing', async () => {
        clearDemoWalletId();
        markDemoWallet('w');
        try {
            const { utils, calls } = await openMarket(feed('closed'));
            const panel = await openActions(utils);
            await domAct(async () => { fireEvent.click(within(panel).getByRole('button', { name: /^Post result/ })); await drain(); });
            const outcomes = utils.getByRole('group', { name: 'Winning outcome' });
            await domAct(async () => { fireEvent.click(within(outcomes).getByRole('button', { name: 'Yes' })); await drain(); });
            const publish = utils.getByRole('button', { name: 'Publish Result' });
            expect(publish).toBeEnabled();
            await domAct(async () => { fireEvent.click(publish); await drain(); });
            expect(within(utils.container.querySelector('[data-outcome-owner-actions]')).getByText(/Demo wallets can.t move funds/)).toBeTruthy();
            expect(calls.some((c) => c.method === 'composeBetForConfirm')).toBe(false);
        } finally {
            clearDemoWalletId();
        }
    });

    it('keeps the cancel confirm on the Cancel and refund row', async () => {
        const { utils, calls } = await openMarket(feed('closed'));
        const panel = await openActions(utils);

        await domAct(async () => { fireEvent.click(within(panel).getByRole('button', { name: /^Cancel and refund/ })); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: 'Cancel Market' })); await drain(); });
        expect(calls.find((c) => c.method === 'composeBetForConfirm').args.builder).toBe('cancelMarketParams');
    });
});

describe('oracleActionLegality', () => {
    const owner = { address: OWN };
    it('allows resolve only between the deadline and the refund end, cancel only before terminal', () => {
        expect(oracleActionLegality({ ...feed('closed'), owner }, now())).toEqual({ canResolve: true, canCancel: true, canEdit: false });
        expect(oracleActionLegality({ ...feed('closed', { expire_at: now() - 1 }), owner }, now()))
            .toEqual({ canResolve: false, canCancel: true, canEdit: false });
        expect(oracleActionLegality({ ...feed('open'), owner }, now())).toEqual({ canResolve: false, canCancel: true, canEdit: true });
        for (const status of ['resolved', 'resolved_void', 'cancelled', 'expired']) {
            expect(oracleActionLegality({ ...feed(status), owner }, now())).toEqual({ canResolve: false, canCancel: false, canEdit: false });
        }
    });
});
