// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lock address signs on the legacy review path, with no pre-flight between
// the typed LOCK and the signature. A locked address cannot submit any XChain
// action until its wake block, a new lock included, so the indexer refuses a
// second lock after the fee is spent. The form refuses while the address is
// locked or while its lock state is unread, and reads the state again just
// before it signs, since another surface can lock the address meanwhile.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId }) => React.createElement('p', null, `Picker chain: ${chainId}`),
}));

const BITCOIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02btc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(sleepState) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BITCOIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        sleepState,
        sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SleepForm walletId="wallet-1" mode="address" initialChainId={BITCOIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Lock address refuses an address it cannot lock', () => {
    it('refuses an address that is already locked until a later block', async () => {
        const messaging = mount(vi.fn().mockResolvedValue({ resumeBlock: 999 }));
        const line = await screen.findByText(
            "This address is locked until block 999. A locked address can't create any XChain action, a new lock included, until it wakes.",
        );
        // One plain muted line: no notice bubble, no status row, no status text.
        expect(line.tagName).toBe('P');
        expect(line.closest('[role="alert"], [role="status"], [data-variant]')).toBeNull();
        expect(screen.queryByText('Locked until block 999')).toBeNull();
        expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled();
        fireEvent.submit(screen.getByRole('button', { name: /^Lock address$/i }).closest('form'));
        expect(screen.queryByLabelText('Type LOCK to confirm')).toBeNull();
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('refuses an address that is locked for good', async () => {
        const messaging = mount(vi.fn().mockResolvedValue({ resumeBlock: -1 }));
        const line = await screen.findByText(
            "This address is locked for good. A locked address can't create any XChain action, a new lock included.",
        );
        expect(line.closest('[role="alert"], [role="status"], [data-variant]')).toBeNull();
        expect(screen.queryByText('Locked indefinitely')).toBeNull();
        expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled();
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('refuses while the lock state cannot be read', async () => {
        const messaging = mount(vi.fn().mockRejectedValue(new Error('explorer 500')));
        // A failed read is the standard error notice, with no status text.
        const notice = await screen.findByText(
            "The wallet couldn't check whether this address is already locked, so it can't lock it. Check your connection and try again.",
        );
        expect(notice.closest('[role="alert"]')).not.toBeNull();
        expect(screen.queryByText('Current state unavailable')).toBeNull();
        expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled();
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('refuses at sign time when another surface locked the address after review', async () => {
        const sleepState = vi.fn()
            .mockResolvedValueOnce({ resumeBlock: null })
            .mockResolvedValue({ resumeBlock: -1 });
        const messaging = mount(sleepState);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: /^Lock address$/i }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        const approve = screen.getByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        expect(await screen.findByText(
            "This address is locked for good. A locked address can't create any XChain action, a new lock included.",
        )).toBeInTheDocument();
        expect(sleepState).toHaveBeenCalledTimes(2);
        expect(sleepState).toHaveBeenLastCalledWith({ chainId: BITCOIN, query: ADDRESS.address, type: 'address', fresh: true });
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('signs an address that is awake', async () => {
        const messaging = mount(vi.fn().mockResolvedValue({ resumeBlock: 50 }));
        await waitFor(() => expect(screen.getByRole('button', { name: /^Lock address$/i })).toBeEnabled());
        expect(screen.queryByText('Active, not locked')).toBeNull();
        expect(screen.queryByRole('button', { name: /^Unlock address$/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Lock address$/i }));
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        const approve = screen.getByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        expect(await screen.findByText('Lock address broadcast')).toBeInTheDocument();
        expect(messaging.sleepAction).toHaveBeenCalledTimes(1);
    });

    it('disables the submit while the lock state loads', async () => {
        mount(vi.fn(() => new Promise(() => {})));
        const button = await screen.findByRole('button', { name: /^Lock address$/i });
        expect(button).toBeDisabled();
        expect(screen.queryByText('Checking current state')).toBeNull();
    });
});
