// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messaging(overrides = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue({});
            target[property] = stub;
            return stub;
        },
    });
}

function renderRoute(route, host) {
    return render(
        <MessagingProvider shell="web" messaging={host}>
            {route}
        </MessagingProvider>,
    );
}

let originalResizeObserver;
beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
});

describe('protocol detail route accessibility', () => {
    it('scans a loaded dispenser detail', async () => {
        const host = messaging({
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                action_index: '7',
                source: ADDRESS.address,
                give_tick: 'A11Y',
                give_quantity: '100',
                escrow_quantity: '500',
                satoshirate: '1000',
                status: 'valid',
            }),
            getDispenses: vi.fn().mockResolvedValue({ data: [] }),
            getDispenserLifecycle: vi.fn().mockResolvedValue({ data: [] }),
            getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 0 }),
            getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 600 }),
        });
        const { container } = renderRoute(
            <DispenserDetail walletId="wallet-1" chainId={CHAIN} actionIndex="7" onBack={() => {}} />,
            host,
        );

        await screen.findByRole('heading', { name: 'Dispenser details' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a loaded validator stake detail', async () => {
        const host = messaging({
            getStakesForAddress: vi.fn().mockResolvedValue({ data: [{
                action_index: '8', source: ADDRESS.address, asset: 'XCHAIN', quantity: '25', status: 'valid',
            }] }),
            getDelegationsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getRewardsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        });
        const { container } = renderRoute(
            <StakeDetail
                walletId="wallet-1"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS.address}
                onBack={() => {}}
                onUnstake={() => {}}
                onDelegate={() => {}}
                onClaimRewards={() => {}}
            />,
            host,
        );

        await screen.findByRole('heading', { name: 'Position details' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans an open poll detail', async () => {
        const host = messaging({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: '9',
                source: ADDRESS.address,
                tick: 'VOTE',
                question: 'Is this screen accessible?',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                max_selections: 1,
                poll_status: 'open',
                end_block: 200,
            }),
            governanceVotes: vi.fn().mockResolvedValue({ data: [] }),
        });
        const { container } = renderRoute(
            <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex="9" onBack={() => {}} />,
            host,
        );

        await screen.findByText('Is this screen accessible?');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans an open bet feed detail', async () => {
        const host = messaging({
            betFeed: vi.fn().mockResolvedValue({ data: [{
                action_index: '10',
                source: ADDRESS.address,
                label: 'Will accessibility keep improving?',
                outcomes: 'Yes,No',
                tick: 'A11Y',
                fee: '1',
                deadline: Math.floor(Date.now() / 1000) + 86_400,
                expire_at: Math.floor(Date.now() / 1000) + 172_800,
                feed_status: 'open',
                pools: [
                    { outcome: 0, pool: '25', bet_count: 2 },
                    { outcome: 1, pool: '10', bet_count: 1 },
                ],
                timeline: [{ status: 'open', block_index: 100 }],
            }] }),
            bets: vi.fn().mockResolvedValue({ data: [] }),
        });
        const { container } = renderRoute(
            <BetFeedDetail walletId="wallet-1" chainId={CHAIN} feedIndex="10" onBack={() => {}} />,
            host,
        );

        await screen.findByText('Will accessibility keep improving?');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a loaded contract execute form', async () => {
        const host = messaging({
            getContractByActionIndex: vi.fn().mockResolvedValue({ data: {
                abi: { version: 1, methods: { configure: { params: [
                    { name: 'limit', type: 'amount' },
                ] } } },
            } }),
        });
        const { container } = renderRoute(
            <ExecuteContractForm
                walletId="wallet-1"
                chainId={CHAIN}
                contractActionIndex="11"
                onBack={() => {}}
            />,
            host,
        );

        await screen.findByLabelText('limit (amount)');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a loaded swap form', async () => {
        const { container } = renderRoute(
            <SwapForm walletId="wallet-1" initialChainId={CHAIN} onBack={() => {}} />,
            messaging(),
        );

        await screen.findByRole('button', { name: 'Give and get chain: Bitcoin' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a loaded list detail', async () => {
        const host = messaging({
            getListByActionIndex: vi.fn().mockResolvedValue({
                action_index: '12',
                type: '0',
                status: 'valid',
                source: ADDRESS.address,
                name: 'Accessibility reviewers',
                description: 'Addresses allowed to review accessibility changes.',
                list: [ADDRESS.address],
                edits: [],
            }),
            getActionFormats: vi.fn().mockResolvedValue([]),
        });
        const { container } = renderRoute(
            <ListDetail chainId={CHAIN} actionIndex="12" onBack={() => {}} onFork={() => {}} />,
            host,
        );

        await screen.findByText('Accessibility reviewers');
        await expectNoSeriousAxeViolations(container);
    });
});
