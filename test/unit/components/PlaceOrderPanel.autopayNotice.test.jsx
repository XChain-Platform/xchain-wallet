// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The web wallet's auto-pay keep-open fact is a confirm-screen notice: the
// panel carries no acknowledgement checkbox and never refuses for one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({ open: false, confirmProps: null, run: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useActionConfirmFlow: () => ({
        open: state.open,
        composing: false,
        run: state.run,
        confirmAction: { phase: state.open ? 'ready' : 'idle' },
    }),
}));

// The confirm screen itself is covered by its own suites; this one reads
// what the panel hands it.
vi.mock('../../../packages/core/src/shared/components/ActionConfirmScreen.jsx', () => ({
    ActionConfirmScreen: (props) => {
        state.confirmProps = props;
        return <div data-testid="confirm-screen">{props.summary?.notice || ''}</div>;
    },
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};
const HARDWARE_ADDRESS = {
    id: 'a2', address: 'bc1qhardware', publicKey: '03ab', derivationPath: "m/84'/0'/0'/0/1", source: 'trezor', signerId: 's2',
};
const NOTICE = 'Auto pay runs inside this wallet: a match is paid while the wallet is open, even when it\'s locked.';
const HARDWARE_NOTICE = "Auto pay can't be used with a hardware wallet address. Each payment needs you to connect your device and approve it.";

const messaging = {
    getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
    getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
    getWalletBalances: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue({}),
    listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'full' }]),
    signerReady: vi.fn().mockResolvedValue({ ready: true }),
    getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    getAutopayExposure: vi.fn().mockResolvedValue({}),
    composeForConfirm: vi.fn(),
};

// A buy of XCHAIN gives BTC, the native coin, so auto-pay can arm.
function panel(shell) {
    return (
        <MessagingProvider shell={shell} messaging={messaging}>
            <PlaceOrderPanel walletId="w" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
        </MessagingProvider>
    );
}

async function mount(shell = 'web') {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const utils = render(panel(shell));
    const autoPay = await screen.findByRole('switch', { name: 'Auto pay' });
    expect(autoPay).toBeEnabled();
    expect(autoPay).toBeChecked();
    return {
        openConfirm() {
            state.open = true;
            utils.rerender(panel(shell));
            return screen.getByTestId('confirm-screen');
        },
    };
}

beforeEach(() => {
    state.open = false;
    state.confirmProps = null;
    state.run.mockReset();
    messaging.getAddressesByChain.mockResolvedValue({ [CHAIN]: [ADDRESS] });
    messaging.getActiveAddresses.mockResolvedValue({ [CHAIN]: ADDRESS.id });
    localStorage.clear();
});

afterEach(() => { cleanup(); resetWalletModes(); });

describe('PlaceOrderPanel auto-pay notice', () => {
    it('shows a hardware paying address with Auto pay disabled and off', async () => {
        messaging.getAddressesByChain.mockResolvedValue({ [CHAIN]: [HARDWARE_ADDRESS] });
        messaging.getActiveAddresses.mockResolvedValue({ [CHAIN]: HARDWARE_ADDRESS.id });
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
        render(panel('desktop'));

        const autoPay = await screen.findByRole('switch', { name: 'Auto pay' });
        expect(autoPay).toBeDisabled();
        expect(autoPay).not.toBeChecked();
        expect(autoPay.closest('label').nextElementSibling).toHaveTextContent(HARDWARE_NOTICE);
    });

    it('puts no acknowledgement checkbox on the panel', async () => {
        await mount();
        expect(screen.queryByRole('checkbox', { name: /I understand/ })).toBeNull();
        expect(document.body).not.toHaveTextContent(/I understand/);
    });

    it('states the keep-open fact on the confirm screen of an armed web order', async () => {
        const { openConfirm } = await mount();
        expect(openConfirm()).toHaveTextContent(NOTICE);
        expect(state.confirmProps.summary?.notice).toBe(NOTICE);
    });

    it('carries no notice once auto-pay is turned off', async () => {
        const { openConfirm } = await mount();
        fireEvent.click(screen.getByRole('switch', { name: 'Auto pay' }));
        openConfirm();
        expect(state.confirmProps.summary?.notice).toBeUndefined();
    });

    it('carries no notice outside the web wallet, which keeps a background watcher', async () => {
        const { openConfirm } = await mount('desktop');
        openConfirm();
        expect(state.confirmProps.summary?.notice).toBeUndefined();
    });

    it('keeps an auto-pay setup failure out of the placed-order message', async () => {
        state.run.mockResolvedValue({
            txid: 'abc',
            autopayArmed: false,
            autopayConsentError: 'recordAutopayConsent: txid is required',
        });
        await mount();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Buy Order' }));

        expect(await screen.findByText(/The order was placed, but auto pay couldn't be armed/)).toBeTruthy();
        expect(document.body).not.toHaveTextContent(/recordAutopayConsent|txid is required/);
    });
});
