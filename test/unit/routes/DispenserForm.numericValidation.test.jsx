// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mountForm({
    walletMode = 'full',
    onBack = vi.fn(),
    buildActionPsbtRequest,
    generateDispenserAddress,
    getWalletBalances,
    getTokenInfo,
} = {}) {
    const composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
    });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: getWalletBalances || vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getTokenInfo: getTokenInfo || vi.fn().mockResolvedValue(null),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        composeForConfirm,
        buildActionPsbtRequest: buildActionPsbtRequest || vi.fn().mockResolvedValue({
            psbtHex: '70736274ff', encoding: 'psbt', fromAddress: SOURCE.address,
        }),
        generateDispenserAddress,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserForm
                    walletId="w"
                    initialChainId={CHAIN}
                    initialTick="JDOG"
                    onBack={onBack}
                />
            </MessagingProvider>,
        );
        await drainMicrotasks();
    });
    return { ...utils, composeForConfirm, buildActionPsbtRequest: target.buildActionPsbtRequest, onBack };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DispenserForm numeric validation', () => {
    it('rejects a dispensed amount finer than the token divisibility', async () => {
        const utils = await mountForm({
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'JDOG', divisibility: 2 }),
        });
        const give = utils.getByLabelText(/^Give amount/);

        fireEvent.change(give, { target: { value: '1.234' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.01' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(await utils.findByText('Amount can have at most 2 decimal places.'))
            .toBeInTheDocument();
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('tabs through terms and opens review from Enter only when valid', async () => {
        const user = userEvent.setup();
        const utils = await mountForm();
        const give = utils.getByLabelText(/^Give amount/);
        give.focus();

        // Each amount field carries its own paste control under it.
        await user.tab();
        expect(document.activeElement).toHaveAccessibleName('Paste from clipboard');
        await user.tab();
        const escrow = utils.getByLabelText(/^Escrow amount/);
        expect(document.activeElement).toBe(escrow);
        fireEvent.change(give, { target: { value: 'invalid' } });
        fireEvent.change(escrow, { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.01' } });
        escrow.focus();
        await user.keyboard('{Enter}');

        expect(utils.getByText('Per-fill give amount must be a positive number.')).toBeInTheDocument();
        expect(utils.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(give, { target: { value: '10' } });
        escrow.focus();
        await user.keyboard('{Enter}');

        await act(async () => { await drainMicrotasks(); });
        expect(utils.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(utils.getByTestId('confirm-modal')).toBeInTheDocument();

        await user.keyboard('{Escape}');
        await waitFor(() => expect(utils.getByLabelText(/^Give amount/)).toHaveValue('10'));
        expect(utils.queryByTestId('confirm-modal')).toBeNull();
    });

    it('refuses a malformed trigger price before composing', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: 'many' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('Trigger price must be a positive number.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.01' } });
        expect(utils.queryByText('Trigger price must be a positive number.')).toBeNull();
    });

    it('rejects malformed give and escrow decimals before composing', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '1.' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('Per-fill give amount must be a positive number.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects give and escrow values beyond the dispensed token precision', async () => {
        const utils = await mountForm({
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'JDOG', divisibility: 0 }),
        });

        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '1.1' } });
        expect(utils.getByText('Amount can have at most 0 decimal places.')).toBeInTheDocument();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '1' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '10.1' } });
        expect(utils.getByText('Amount can have at most 0 decimal places.')).toBeInTheDocument();
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects payment-token and native prices beyond their asset precision', async () => {
        const utils = await mountForm({
            getTokenInfo: vi.fn().mockImplementation(({ tick }) => Promise.resolve({ tick, divisibility: 0 })),
        });
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '1' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.000000001' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));
        expect(utils.getByRole('alert')).toHaveTextContent('Trigger price can have at most 8 decimal places for BTC.');

        fireEvent.click(utils.getByLabelText('A token'));
        fireEvent.change(utils.getByLabelText('Payment token'), { target: { value: 'PAY' } });
        fireEvent.change(utils.getByLabelText('Payment amount (per fill)'), { target: { value: '1.1' } });
        await waitFor(() => expect(utils.getByRole('button', { name: 'Create' })).toBeEnabled());
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));
        expect(utils.getByRole('alert')).toHaveTextContent('Payment amount must be a whole number because PAY is indivisible.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects escrow above the source balance before composing', async () => {
        const utils = await mountForm({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: SOURCE.address,
                    balances: { tokens: [{ tick: 'JDOG', quantity: '5', divisibility: 0 }] },
                }],
            }),
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'JDOG', divisibility: 0 }),
        });
        await waitFor(() => expect(utils.getAllByText('5 JDOG available')).toHaveLength(2));
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '1' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '6' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('This address holds only 5 JDOG.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('returns from watcher review with all form values kept', async () => {
        const utils = await mountForm({
            walletMode: 'watcher',
            generateDispenserAddress: vi.fn().mockResolvedValue({
                id: 'dispenser', address: 'bc1qdispenserdispenserdispenserdispens',
            }),
        });
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));
        expect(await utils.findByText(/Each time someone sends 0.001 BTC/)).toBeInTheDocument();

        fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' }));
        expect(utils.getByLabelText(/^Give amount/)).toHaveValue('10');
        expect(utils.getByLabelText(/^Escrow amount/)).toHaveValue('100');
        expect(utils.getByLabelText(/^Trigger price/)).toHaveValue('0.001');
    });

    it('validates the payment-token ticker before composing', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.click(utils.getByLabelText('A token'));
        fireEvent.change(utils.getByLabelText('Payment token'), { target: { value: 'BAD/NAME' } });
        fireEvent.change(utils.getByLabelText('Payment amount (per fill)'), { target: { value: '1' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent(/Payment token/i);
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('titles the screen in sentence case like every other form', async () => {
        const utils = await mountForm();
        expect(utils.getByRole('heading', { name: 'Create dispenser' })).toBeInTheDocument();
    });

    it('requires a currency for a fiat amount instead of silently dropping the field', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.click(utils.getByRole('button', { name: /Advanced options/ }));
        fireEvent.change(utils.getByLabelText(/^Fiat amount/), { target: { value: '12.34' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('Fiat pricing needs a fiat currency.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects an oracle address that is invalid for the selected chain', async () => {
        const utils = await mountForm();
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.click(utils.getByRole('button', { name: /Advanced options/ }));
        fireEvent.change(utils.getByLabelText('Priced in fiat (optional)'), { target: { value: 'USD' } });
        fireEvent.change(utils.getByLabelText(/^Oracle address/), { target: { value: 'not-an-address' } });
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));

        expect(utils.getByRole('alert')).toHaveTextContent('Oracle address: This is not a valid Bitcoin address.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();
    });

    it('ignores inactive coin fields and reviews the token payment terms', async () => {
        let resolveBuild;
        const buildActionPsbtRequest = vi.fn(() => new Promise((resolve) => { resolveBuild = resolve; }));
        const onBack = vi.fn();
        const utils = await mountForm({
            walletMode: 'watcher',
            onBack,
            buildActionPsbtRequest,
            generateDispenserAddress: vi.fn().mockResolvedValue({
                id: 'dispenser', address: 'bc1qdispenserdispenserdispenserdispens',
            }),
        });
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: 'not-a-price' } });
        fireEvent.click(utils.getByLabelText('A token'));
        fireEvent.change(utils.getByLabelText('Payment token'), { target: { value: 'PAY' } });
        fireEvent.change(utils.getByLabelText('Payment amount (per fill)'), { target: { value: '2' } });

        await act(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create' }));
            await drainMicrotasks();
        });
        expect(utils.getByText(/Each time someone sends 2 PAY/)).toBeInTheDocument();
        expect(utils.getAllByText('Dispenser address')).toHaveLength(1);

        await act(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' }));
            await Promise.resolve();
        });
        expect(utils.getByRole('button', { name: 'Create unsigned transaction' })).toBeDisabled();
        expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            actionData: {
                action: 'DISPENSER',
                params: expect.objectContaining({ GET_TICK: 'PAY', GET_AMOUNT: '2' }),
            },
        }));
        expect(buildActionPsbtRequest.mock.calls[0][0].actionData.params).not.toHaveProperty('ORACLE_ADDRESS');
        expect(buildActionPsbtRequest.mock.calls[0][0].actionData.params.GET_AMOUNT).not.toBe('not-a-price');

        await act(async () => {
            resolveBuild({ psbtHex: '70736274ff', encoding: 'psbt', fromAddress: SOURCE.address });
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Unsigned transaction hex')).toHaveValue('70736274ff');
        fireEvent.click(utils.getByRole('button', { name: 'Done' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
