// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RECIPIENT = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: SOURCE,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingFor(walletMode, overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS }),
        getSettings: vi.fn().mockResolvedValue({ walletMode, activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 1000 }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'TOKEN', quantity: '100000000000', divisibility: 8 },
                        { tick: 'DROP', quantity: '100000000000', divisibility: 8 },
                    ],
                },
            }],
        }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'TOKEN', divisibility: 8, locks: {},
        }),
        getListsForSource: vi.fn().mockResolvedValue([]),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        betProjectFeedCreateFee: vi.fn().mockResolvedValue({
            free: true, fee: '0', days: 14, billableDays: 0,
        }),
        generateDispenserAddress: vi.fn().mockResolvedValue({
            id: 'dispenser-1',
            address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(confirmEnvelope()),
        composeBetForConfirm: vi.fn().mockResolvedValue(confirmEnvelope()),
        composeVoteForConfirm: vi.fn().mockResolvedValue(confirmEnvelope()),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function confirmEnvelope() {
    return {
        psbt: 'aa00',
        encoding: 'psbt',
        actionString: 'ACT',
        version: 0,
        chainId: CHAIN,
        decoded: {
            summary: 'Review this protocol action.',
            details: [{ label: 'Action', value: 'Protocol action' }],
            warnings: [],
        },
    };
}

function mount(Component, walletMode, props = {}, overrides = {}) {
    const messaging = messagingFor(walletMode, overrides);
    const result = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component walletId="wallet-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { ...result, messaging };
}

async function auditReview(container, name) {
    expect(await screen.findByRole('form', { name })).toBeTruthy();
    await expectNoSeriousAxeViolations(container);
}

async function auditConfirm(container) {
    expect(await screen.findByTestId('confirm-modal')).toBeTruthy();
    await expectNoSeriousAxeViolations(container);
}

async function eachReviewMode(open) {
    const watcher = await open('watcher');
    await auditReview(watcher.container, watcher.reviewName);
    cleanup();

    const full = await open('full');
    await auditConfirm(full.container);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('protocol form review accessibility', () => {
    it('audits issue review and confirm screens', async () => {
        await eachReviewMode(async (walletMode) => {
            const mounted = mount(IssueTokenForm, walletMode);
            fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'TOKEN' } });
            fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
            fireEvent.click(screen.getByRole('button', { name: walletMode === 'watcher' ? 'Preview' : 'Issue token' }));
            return { ...mounted, reviewName: 'Review token issue' };
        });
    });

    it('audits dispenser review and confirm screens', async () => {
        await eachReviewMode(async (walletMode) => {
            const mounted = mount(DispenserForm, walletMode, {
                initialChainId: CHAIN,
                initialTick: 'TOKEN',
            });
            fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
            fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
            fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.01' } });
            fireEvent.click(screen.getByRole('button', { name: 'Create' }));
            return { ...mounted, reviewName: 'Review dispenser' };
        });
    });

    it('audits order review and confirm screens', async () => {
        await eachReviewMode(async (walletMode) => {
            const mounted = mount(CreateOrderForm, walletMode, { initialChainId: CHAIN });
            const ticker = await screen.findByLabelText('Ticker');
            fireEvent.change(ticker, { target: { value: 'TOKEN' } });
            const amounts = screen.getAllByLabelText(/^(Amount|Amount \(BTC\))$/);
            fireEvent.change(amounts[0], { target: { value: '10' } });
            fireEvent.change(amounts[1], { target: { value: '0.001' } });
            fireEvent.click(screen.getByRole('button', { name: walletMode === 'watcher' ? 'Preview' : 'Place order' }));
            return { ...mounted, reviewName: 'Review order' };
        });
    });

    it('audits the betting confirm screen', async () => {
        const mounted = mount(CreateBetFeedForm, 'full', {
            chainId: CHAIN,
            presetTick: 'TOKEN',
        });
        fireEvent.change(await screen.findByLabelText('What is being bet on'), {
            target: { value: 'Will the accessibility audit pass?' },
        });
        fireEvent.change(screen.getByLabelText('Outcome 0'), { target: { value: 'Yes' } });
        fireEvent.change(screen.getByLabelText('Outcome 1'), { target: { value: 'No' } });
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
        fireEvent.change(screen.getByLabelText('Betting closes'), { target: { value: tomorrow } });
        fireEvent.click(screen.getByRole('button', { name: 'Review market' }));
        await auditConfirm(mounted.container);
    });

    it('audits vote review and confirm screens', async () => {
        await eachReviewMode(async (walletMode) => {
            const mounted = mount(CreatePollForm, walletMode, {
                chainId: CHAIN,
                presetTick: 'TOKEN',
            });
            fireEvent.change(await screen.findByLabelText('Option 0'), { target: { value: 'Yes' } });
            fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'No' } });
            fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '1100' } });
            fireEvent.click(screen.getByRole('button', {
                name: walletMode === 'watcher' ? 'Preview' : 'Create poll',
            }));
            return { ...mounted, reviewName: 'Review poll' };
        });
    });

    it('audits sleep review and confirm screens', async () => {
        const addressReview = mount(SleepForm, 'full', {
            mode: 'address',
            initialChainId: CHAIN,
        });
        fireEvent.change(await screen.findByLabelText('Duration (blocks)'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        await auditReview(addressReview.container, 'Review lock address');
        cleanup();

        const tokenConfirm = mount(SleepForm, 'full', {
            mode: 'tick',
            initialChainId: CHAIN,
            initialTick: 'TOKEN',
        });
        fireEvent.change(await screen.findByLabelText('Duration (blocks)'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pause token' }));
        await auditConfirm(tokenConfirm.container);
    });

    it('audits airdrop recipient review and confirm screens', async () => {
        const mounted = mount(AirdropForm, 'full', {
            initialChainId: CHAIN,
            initialTick: 'DROP',
        }, {
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN, tick: 'DROP', divisibility: 8, locks: {},
            }),
        });
        fireEvent.change(await screen.findByLabelText(/^Per-recipient amount/), {
            target: { value: '1' },
        });
        fireEvent.change(screen.getByLabelText('Recipients'), { target: { value: RECIPIENT } });
        await waitFor(() => expect(screen.getByText(/1 valid address/)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Review recipients' }));
        await auditReview(mounted.container, 'Review recipient list');

        fireEvent.click(screen.getByRole('button', { name: /Sign address list/ }));
        await auditConfirm(mounted.container);
    });
});
