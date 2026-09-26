// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OpenOrdersPanel } from '../../../packages/core/src/shared/components/OpenOrdersPanel.jsx';

const lane = vi.hoisted(() => ({
    open: false,
    composing: false,
    run: vi.fn(),
    hook: vi.fn(),
    resolve: null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: (args) => {
        lane.hook(args);
        return {
            open: lane.open,
            composing: lane.composing,
            run: lane.run,
            confirmProps: { confirmAction: { phase: 'ready' } },
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({ flag: false, mandatory: false }),
}));

vi.mock('../../../packages/core/src/shared/components/ActionConfirmScreen.jsx', () => ({
    ActionConfirmScreen: () => (
        <div data-testid="order-cancel-confirm">Network pre-flight confirmation</div>
    ),
}));

const OWNER = {
    id: 'address-1',
    address: 'bc1qownerexampleexampleexampleexampleexample',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mountPanel() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [OWNER] }),
        getMarketOrders: vi.fn().mockResolvedValue([{
            action_index: 17,
            give_tick: 'XCP',
            get_tick: 'PEPE',
            give_amount: '10',
            get_amount: '20',
            give_remaining: '10',
        }]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        cancelOrder: vi.fn(),
        cancelOrderHw: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <OpenOrdersPanel
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                tick1="XCP"
                tick2="PEPE"
            />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    lane.open = false;
    lane.composing = false;
    lane.resolve = null;
    lane.hook.mockClear();
    lane.run.mockReset();
    lane.run.mockImplementation(() => {
        lane.open = true;
        return new Promise((resolve) => { lane.resolve = resolve; });
    });
});

afterEach(() => cleanup());

describe('OpenOrdersPanel cancellation confirmation', () => {
    it('composes through the owner-action lane and replaces the panel while confirming', async () => {
        const messaging = mountPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

        await screen.findByTestId('order-cancel-confirm');
        expect(screen.queryByText(/Cancel order #17/)).toBeNull();
        expect(lane.hook).toHaveBeenLastCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            owner: OWNER,
            software: 'cancelOrder',
            hardware: 'cancelOrderHw',
        }));
        expect(lane.run).toHaveBeenCalledWith({
            actionData: {
                action: 'ORDER',
                params: { VERSION: '1', ORDER_ACTION_INDEX: '17' },
            },
            encoderOpts: {},
            submitExtra: { orderActionIndex: '17' },
        });
        expect(messaging.cancelOrder).not.toHaveBeenCalled();
        expect(messaging.cancelOrderHw).not.toHaveBeenCalled();

        lane.open = false;
        await act(async () => lane.resolve({ txid: 'cancel-txid' }));
        await waitFor(() => {
            expect(screen.getByText('No open orders on this market.')).toBeTruthy();
        });
    });
});
