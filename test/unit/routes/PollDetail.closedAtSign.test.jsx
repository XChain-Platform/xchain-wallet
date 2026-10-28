// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The poll page decides "open" from its last read, and the review it opens
// signs whatever was composed. A poll that closes while the review sits open
// (its end block passes, or it is finalized) still signs and broadcasts the
// ballot: it pays the miner fee and the protocol fee and counts for nothing.
// Approve reads the poll fresh and refuses one that is no longer open, even
// while an ordinary read still returns the open row from the reuse cache.

import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const POLL = Object.freeze({
    action_index: 7,
    tick: 'VOTE',
    question: 'Choose a release channel',
    options: ['Stable', 'Preview'],
    tally_mode: 'approval',
    weight_mode: 'balance',
    max_selections: 1,
    end_block: 120,
    poll_status: 'open',
});
const COMPOSED = Object.freeze({ psbt: 'bb00', encoding: 'psbt', actionString: 'VOTE|0|7|0', version: 1 });

afterEach(cleanup);

async function drain(rounds = 30) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function harness({ later, walletMode = 'full' }) {
    const calls = { cast: 0, build: 0, pollRequests: [], heightRequests: [] };
    const target = {
        governancePoll: (request) => {
            calls.pollRequests.push(request);
            return request.fresh ? later.poll() : Promise.resolve(POLL);
        },
        getIndexerWatermark: (request) => {
            calls.heightRequests.push(request);
            return request.fresh ? later.height() : Promise.resolve({ watermark: 100 });
        },
        governancePollResults: () => Promise.resolve([]),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: ADDRESS.id } }),
        governanceVotes: () => Promise.resolve([]),
        getSettings: () => Promise.resolve({ walletMode, preflightPrivacy: 'off' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeVoteForConfirm: () => Promise.resolve(COMPOSED),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        buildActionPsbtRequest: () => {
            calls.build += 1;
            return Promise.resolve({ psbtHex: 'cc00' });
        },
        castBallotAction: () => {
            calls.cast += 1;
            return Promise.resolve({ txid: 'tx-vote' });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, calls };
}

async function approveVote(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(PollDetail, { walletId: 'wallet-1', chainId: CHAIN, pollIndex: 7, onBack() {} }),
        ));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('checkbox', { name: '0: Stable' }));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Vote' }));
        await drain();
    });
    const approve = utils.getByTestId('confirm-approve');
    await domAct(async () => {
        fireEvent.click(approve);
        await drain(60);
    });
    return utils;
}

describe('Poll page: a poll that closes between Review and Approve', () => {
    it('refuses when the end block has passed', async () => {
        const { messaging, calls } = harness({
            later: { poll: () => Promise.resolve(POLL), height: () => Promise.resolve({ watermark: 121 }) },
        });
        const utils = await approveVote(messaging);
        expect(calls.cast).toBe(0);
        expect(utils.container.textContent).toMatch(/This poll closed while the review was open\. Nothing was sent\./);
    });

    it('refuses a freshly closed poll while the reusable row is still open', async () => {
        const { messaging, calls } = harness({
            later: {
                poll: () => Promise.resolve({ ...POLL, poll_status: 'finalized' }),
                height: () => Promise.resolve({ watermark: 100 }),
            },
        });
        await approveVote(messaging);
        expect(calls.cast).toBe(0);
        expect(calls.pollRequests).toEqual([
            { chainId: CHAIN, pollIndex: 7 },
            { chainId: CHAIN, pollIndex: 7, fresh: true },
        ]);
        expect(calls.heightRequests).toEqual([
            { chainId: CHAIN },
            { chainId: CHAIN, fresh: true },
        ]);
    });

    it('signs when the poll still reads open', async () => {
        const { messaging, calls } = harness({
            later: { poll: () => Promise.resolve(POLL), height: () => Promise.resolve({ watermark: 120 }) },
        });
        await approveVote(messaging);
        expect(calls.cast).toBe(1);
    });

    it('signs when the fresh read fails, which says nothing about the poll', async () => {
        const { messaging, calls } = harness({
            later: { poll: () => Promise.reject(new Error('offline')), height: () => Promise.reject(new Error('offline')) },
        });
        await approveVote(messaging);
        expect(calls.cast).toBe(1);
    });
});

async function buildWatcherVote(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(PollDetail, { walletId: 'wallet-1', chainId: CHAIN, pollIndex: 7, onBack() {} }),
        ));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('checkbox', { name: '0: Stable' }));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Vote' }));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' }));
        await drain(60);
    });
    return utils;
}

// Watcher mode builds an unsigned transaction that an air-gapped signer signs
// and broadcasts, so the build takes the same fresh read.
describe('Poll page, watcher mode: a poll that closes before the unsigned build', () => {
    it('refuses to build a ballot for a poll past its end block', async () => {
        const { messaging, calls } = harness({
            walletMode: 'watcher',
            later: { poll: () => Promise.resolve(POLL), height: () => Promise.resolve({ watermark: 121 }) },
        });
        const utils = await buildWatcherVote(messaging);
        expect(calls.build).toBe(0);
        expect(utils.container.textContent).toMatch(/This poll closed while the review was open/);
    });

    it('builds the ballot while the poll still reads open', async () => {
        const { messaging, calls } = harness({
            walletMode: 'watcher',
            later: { poll: () => Promise.resolve(POLL), height: () => Promise.resolve({ watermark: 110 }) },
        });
        await buildWatcherVote(messaging);
        expect(calls.build).toBe(1);
    });
});
