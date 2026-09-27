// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';
import { __clearSignerInfoCache } from '../../../packages/core/src/shared/hooks/useSignerInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'address-1',
    address: 'bc1qoperatoroperatoroperatoroperatoroperator',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'BROADCAST|3|700|123.45',
    version: 1,
    chainId: CHAIN,
    networkFeeSats: 1234,
    decoded: { summary: 'Publish 123.45 to feed 700', details: [], warnings: [] },
});
const HARD_FAIL = Object.freeze({
    verdict: 'fail',
    findings: [{
        severity: 'error',
        code: 'DRYRUN_INVALID',
        message: 'The dry run rejected this action.',
        overridable: false,
    }],
});

afterEach(() => {
    cleanup();
    __clearSignerInfoCache();
});

function mount(report) {
    const methods = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listSigners: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue({
            data: [{ action_index: '700', action_format: 2, block_index: 90, message: 'BTC/USD', status: 'valid' }],
        }),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue(report),
        broadcastAction: vi.fn().mockResolvedValue({ txid: 'software-txid' }),
        broadcastActionHw: vi.fn().mockResolvedValue({ txid: 'hardware-txid' }),
        listWallets: vi.fn().mockResolvedValue([]),
        reserve: vi.fn().mockResolvedValue({ id: 'reservation-1' }),
        releaseReservation: vi.fn().mockResolvedValue(null),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'pass', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
    };
    const messaging = new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(OperatorDashboard, {
            walletId: 'wallet-1', chainId: CHAIN, address: OWNER.address, onBack() {},
        }),
    ));
    return methods;
}

async function reachConfirm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.queryByText('Loading source address…')).toBeNull());
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '123.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));
    return screen.findByTestId('confirm-approve');
}

describe('operator dashboard confirm layout', () => {
    it('shows fee, decoded summary and a disabled Approve when the dry run fails hard', async () => {
        const methods = mount(HARD_FAIL);
        const approve = await reachConfirm();
        await waitFor(() => expect(methods.preflight).toHaveBeenCalledTimes(1));

        expect(await screen.findByText('The dry run rejected this action.')).toBeTruthy();
        expect(screen.getByTestId('confirm-modal')).toBeTruthy();
        expect(screen.getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.00001234 BTC');
        expect(screen.getAllByText(/Publish 123\.45 to feed 700/).length).toBeGreaterThan(0);
        expect(screen.getByTestId('confirm-reject')).toBeEnabled();
        expect(approve).toBeDisabled();

        fireEvent.click(approve);
        expect(methods.broadcastAction).not.toHaveBeenCalled();
        expect(methods.broadcastActionHw).not.toHaveBeenCalled();
    });

    it('enables Approve on the same layout when the dry run passes', async () => {
        const methods = mount({ verdict: 'pass', findings: [] });
        const approve = await reachConfirm();
        await waitFor(() => expect(methods.preflight).toHaveBeenCalledTimes(1));

        await waitFor(() => expect(approve).toBeEnabled());
        expect(screen.getByTestId('confirm-fee')).toBeTruthy();
        expect(screen.getAllByText(/Publish 123\.45 to feed 700/).length).toBeGreaterThan(0);
    });
});
