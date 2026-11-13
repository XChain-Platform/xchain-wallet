// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web wallet's auto-pay keep-open fact is a confirm-screen notice: the
// form carries no acknowledgement checkbox and never refuses for one.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
    shell: 'web',
    phase: 'idle',
    messaging: {},
    confirmProps: null,
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: state.messaging, shell: state.shell }),
    screenVariantFor: () => 'web',
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: false }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionForm.js', () => ({
    useActionForm: () => {
        const fromAddress = {
            id: 'address-1',
            address: 'mSourceAddress',
            publicKey: '02abcd',
            derivationPath: "m/84'/1'/0'/0/0",
            signerId: 'signer-1',
            source: 'hd',
        };
        return {
            addressesByChain: { 'bitcoin-regtest': [fromAddress] },
            loadError: null,
            chainId: 'bitcoin-regtest',
            setChainId: vi.fn(),
            chainsWithAddresses: ['bitcoin-regtest'],
            fromAddress,
            setFromAddressId: vi.fn(),
            descriptor: {
                id: 'bitcoin-regtest',
                coin: 'bitcoin',
                displayName: 'Bitcoin Regtest',
                networkKind: 'regtest',
                ticker: 'BTC',
            },
            signerReady: true,
            isHwSource: false,
            hwStatus: 'available',
            onHwStatusChange: vi.fn(),
            buildFrom: () => fromAddress,
            submit: vi.fn(),
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { preflightPrivacy: 'report' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => ({ phase: state.phase, composing: false, confirm: vi.fn() }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerInfo.js', () => ({
    useSignerInfo: () => null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({
        flag: undefined,
        mandatory: false,
        toggleProps: { checked: false, onChange: vi.fn(), mandatory: false },
    }),
}));

// The confirm screen itself is covered by its own suites; this one reads
// what the form hands it.
vi.mock('../../../packages/core/src/shared/components/ActionConfirmScreen.jsx', () => ({
    ActionConfirmScreen: (props) => {
        state.confirmProps = props;
        return <div data-testid="confirm-screen">{props.summary?.notice || ''}</div>;
    },
}));

import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';

const NOTICE = 'Auto-pay runs inside this wallet: a match is paid only while the wallet is open and unlocked.';

function form() {
    return <CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />;
}

async function renderWithNativeGive() {
    const utils = render(form());
    await screen.findByDisplayValue('mSourceAddress');
    // The form opens giving a token for the coin; the flip makes the coin
    // the give side, which is the one auto-pay can arm.
    fireEvent.click(screen.getByRole('button', { name: 'Flip give and get' }));
    // The auto-pay switch sits in the optional Order Terms section, closed at first.
    fireEvent.click(screen.getByRole('button', { name: /Order Terms/ }));
    expect(screen.getByRole('switch', { name: 'Enable auto-pay' })).toBeChecked();
    return utils;
}

function openConfirm(utils) {
    state.phase = 'ready';
    utils.rerender(form());
    return screen.getByTestId('confirm-screen');
}

beforeEach(() => {
    state.shell = 'web';
    state.phase = 'idle';
    state.confirmProps = null;
    state.messaging = {
        getSettings: vi.fn(async () => ({ preflightPrivacy: 'report' })),
        getAutopayExposure: vi.fn(async () => ({ total: 0 })),
        getTokenInfo: vi.fn(async () => ({ divisibility: 1 })),
        getWalletBalances: vi.fn(async () => ({})),
        getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
    };
    localStorage.clear();
});

afterEach(() => cleanup());

describe('CreateOrderForm auto-pay notice', () => {
    it('puts no acknowledgement checkbox on the form', async () => {
        await renderWithNativeGive();
        expect(screen.queryByRole('checkbox', { name: /I understand/ })).toBeNull();
        expect(document.body).not.toHaveTextContent(/I understand/);
    });

    it('states the keep-open fact on the confirm screen of an armed web order', async () => {
        const utils = await renderWithNativeGive();
        expect(openConfirm(utils)).toHaveTextContent(NOTICE);
        expect(state.confirmProps.summary?.notice).toBe(NOTICE);
    });

    it('carries no notice once auto-pay is switched off', async () => {
        const utils = await renderWithNativeGive();
        fireEvent.click(screen.getByRole('switch', { name: 'Enable auto-pay' }));
        openConfirm(utils);
        expect(state.confirmProps.summary?.notice).toBeUndefined();
    });

    it('carries no notice outside the web wallet, which keeps a background watcher', async () => {
        state.shell = 'desktop';
        const utils = await renderWithNativeGive();
        openConfirm(utils);
        expect(state.confirmProps.summary?.notice).toBeUndefined();
    });
});
