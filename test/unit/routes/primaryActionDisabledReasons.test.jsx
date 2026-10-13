// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qsendersendersendersendersendersendersa',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const NOVEL_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getCapabilityThresholds: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([]),
        getListByActionIndex: vi.fn().mockResolvedValue(null),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        governancePoll: vi.fn().mockResolvedValue({
            action_index: 7,
            tick: 'VOTE',
            poll_status: 'open',
            options: ['Yes', 'No'],
            tally_mode: 'approval',
            max_selections: 1,
        }),
        governancePollResults: vi.fn().mockResolvedValue([]),
        governanceVotes: vi.fn().mockResolvedValue([]),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mount(Component, props = {}, overrides = {}) {
    const messaging = messagingWith(overrides);
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component walletId="wallet-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { ...view, messaging };
}

function expectDescribedBy(button, reason) {
    expect(button).toBeDisabled();
    expect(reason).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', reason.id);
}

afterEach(() => cleanup());

describe('disabled primary actions explain why next to the button', () => {
    it('Issue advances its visible reason as required fields are entered', async () => {
        mount(IssueTokenForm);
        const ticker = await screen.findByLabelText('Ticker');
        const action = screen.getByRole('button', { name: 'Issue token' });
        expectDescribedBy(action, await screen.findByText('Enter a token ticker to continue.'));

        fireEvent.change(ticker, { target: { value: 'WHY' } });
        expectDescribedBy(action, screen.getByText('Enter the token supply to continue.'));

        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        expect(screen.queryByText('Enter the token supply to continue.')).toBeNull();
        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
    });

    it('Stake advances its visible reason as amount and signing key are entered', async () => {
        mount(StakeForm, { chainId: CHAIN });
        const amount = await screen.findByLabelText(/^Amount/);
        const action = screen.getByRole('button', { name: 'Stake' });
        expectDescribedBy(action, await screen.findByText('Enter the amount you want to stake.'));

        fireEvent.change(amount, { target: { value: '25' } });
        expectDescribedBy(action, screen.getByText('Enter the signing public key to continue.'));

        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: 'a'.repeat(64) } });
        expect(screen.queryByText('Enter the signing public key to continue.')).toBeNull();
        expect(action).toBeEnabled();
    });

    it('Order exposes the live preparation reason while composing', async () => {
        const compose = deferred();
        mount(CreateOrderForm, { initialChainId: CHAIN }, {
            composeForConfirm: vi.fn(() => compose.promise),
        });
        await screen.findByLabelText('Ticker');
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'WHY' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.01' } });
        const action = screen.getByRole('button', { name: 'Place order' });
        fireEvent.click(action);

        const reason = await screen.findByText('Preparing the order for review…');
        expectDescribedBy(action, reason);
    });

    it('Dispenser exposes the live address-derivation reason', async () => {
        const generated = deferred();
        mount(DispenserForm, { initialChainId: CHAIN, initialTick: 'WHY' }, {
            generateDispenserAddress: vi.fn(() => generated.promise),
        });
        fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        const action = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(action);

        const reason = await screen.findByText('Preparing the dispenser for review…');
        expectDescribedBy(action, reason);
    });

    it('Vote identifies a poll with no choices as the disabling cause', async () => {
        mount(PollDetail, { chainId: CHAIN, pollIndex: 7 }, {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                poll_status: 'open',
                options: [],
                tally_mode: 'approval',
                max_selections: 1,
            }),
        });
        const action = await screen.findByRole('button', { name: 'Vote' });
        expectDescribedBy(action, document.getElementById('vote-disabled-reason'));
    });

    it('Send adds and removes the adjacent test-send reason with the amount gate', async () => {
        mount(Send, {}, {
            getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 100000 } }),
        });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: NOVEL_ADDRESS } });
        const amount = await screen.findByLabelText(/^Amount \(/);
        fireEvent.change(amount, { target: { value: '0.02' } });

        const action = screen.getByRole('button', { name: /^Send$/ });
        const reason = await screen.findByText('Complete the test-send check to continue.');
        expectDescribedBy(action, reason);

        fireEvent.change(amount, { target: { value: '0.0002' } });
        await waitFor(() => expect(screen.queryByText('Complete the test-send check to continue.')).toBeNull());
        expect(action).toBeEnabled();
        expect(action).not.toHaveAttribute('aria-describedby');
    });
});
