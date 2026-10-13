// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const MAINNET = 'bitcoin-mainnet';
const TESTNET = 'bitcoin-testnet';
const PUBKEY = 'a'.repeat(64);
const MAIN_ADDRESS = {
    id: 'main-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const TEST_ADDRESS = {
    id: 'test-1',
    address: 'tb1qexampleexampleexampleexampleexampleex',
    publicKey: '02cd',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function methods(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET]: [MAIN_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getContractStakesForAddress: vi.fn().mockResolvedValue([]),
        getContractUnstakesForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        buildActionPsbtRequest: vi.fn(() => new Promise(() => {})),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function app(child, messaging) {
    return <MessagingProvider shell="web" messaging={messaging}>{child}</MessagingProvider>;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('staking route request safety', () => {
    it('follows a replaced stake route and ignores the older address load', async () => {
        const oldLoad = deferred();
        const messaging = methods({
            getAddressesByChain: vi.fn()
                .mockReturnValueOnce(oldLoad.promise)
                .mockResolvedValue({
                    [MAINNET]: [MAIN_ADDRESS],
                    [TESTNET]: [TEST_ADDRESS],
                }),
        });
        const props = { walletId: 'w', onBack() {} };
        const view = render(app(<StakeForm {...props} chainId={MAINNET} />, messaging));

        view.rerender(app(<StakeForm {...props} chainId={TESTNET} />, messaging));

        await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(2));
        expect(await screen.findByLabelText('From')).toHaveValue(TEST_ADDRESS.address);

        await act(async () => { oldLoad.resolve({ [MAINNET]: [MAIN_ADDRESS] }); });
        expect(screen.getByLabelText('From')).toHaveValue(TEST_ADDRESS.address);
    });

    it('keeps the reviewed stake request stable and starts one watcher build', async () => {
        const detection = deferred();
        const messaging = methods({ getStakesForAddress: vi.fn(() => detection.promise) });
        render(app(<StakeForm walletId="w" chainId={MAINNET} onBack={() => {}} />, messaging));

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/Stake 1 XCHAIN for signing public key/)).toBeInTheDocument();

        await act(async () => {
            detection.resolve([{ signing_pubkey: PUBKEY, status: 'valid', amount: '5' }]);
        });
        expect(screen.getByText('New stake')).toBeInTheDocument();

        const submit = screen.getByRole('button', { name: 'Create unsigned transaction' });
        act(() => {
            submit.click();
            submit.click();
        });

        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
        expect(messaging.buildActionPsbtRequest.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '1',
            AMOUNT: '1',
            SIGNING_PUBKEY: PUBKEY,
        });
    });

    it('keeps a full-claim amount stable across a refreshed messaging client', async () => {
        const first = methods({
            getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
        });
        const second = methods({
            getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '20' }]),
        });
        const child = <StakingActionForm mode="claim-rewards" walletId="w" chainId={MAINNET} onBack={() => {}} />;
        const view = render(app(child, first));

        await screen.findByText('10 XCHAIN available');
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText('10 XCHAIN (full pending rewards)')).toBeInTheDocument();

        view.rerender(app(child, second));
        await waitFor(() => expect(second.getRewardsForAddress).toHaveBeenCalledTimes(1));
        expect(screen.getByText('10 XCHAIN (full pending rewards)')).toBeInTheDocument();

        const submit = screen.getByRole('button', { name: 'Create unsigned transaction' });
        act(() => {
            submit.click();
            submit.click();
        });

        await waitFor(() => expect(second.buildActionPsbtRequest).toHaveBeenCalledTimes(1));
        expect(second.buildActionPsbtRequest.mock.calls[0][0].actionData.params)
            .toEqual({ VERSION: '0' });
    });

    it('surfaces an unexpected fan-out rejection instead of leaving the list loading', async () => {
        const messaging = methods({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getContractStakesForAddress: vi.fn(() => { throw new Error('contract query crashed'); }),
        });
        render(app(
            <StakingList walletId="w" onOpenStake={() => {}} onNewStake={() => {}} onBack={() => {}} />,
            messaging,
        ));

        expect(await screen.findByText(/contract query crashed/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Loading staking positions')).toBeNull();
    });
});
