// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WatchOnlyBadge } from '../../../packages/core/src/shared/components/WatchOnlyBadge.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qwatcherwatcherwatcherwatcherwatcher00',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function watcherMessaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        updateSettings: vi.fn(),
        ...overrides,
    };
}

function mount(ui, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {ui}
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('watch-only mode audit', () => {
    it('shows the wallet badge only in watcher mode', () => {
        const { rerender } = render(<WatchOnlyBadge visible={false} />);
        expect(screen.queryByRole('status', { name: 'Watch-only wallet' })).toBeNull();
        rerender(<WatchOnlyBadge visible />);
        expect(screen.getByRole('status', { name: 'Watch-only wallet' }).textContent).toBe('Watch-only');
    });

    it('explains that message signing is unavailable without showing a password prompt', async () => {
        mount(<SignMessageForm walletId="wallet-1" onBack={() => {}} />, watcherMessaging());

        expect(await screen.findByText(/watch-only wallet cannot sign messages/i)).toBeTruthy();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sign message' })).toBeNull();
    });

    it('explains that transaction signing is unavailable without showing a password prompt', async () => {
        mount(<PsbtSignForm walletId="wallet-1" onBack={() => {}} />, watcherMessaging());

        expect(await screen.findByText(/watch-only wallet cannot sign transactions/i)).toBeTruthy();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: /sign transaction/i })).toBeNull();
    });

    it('builds unsigned token creation output without opening signing credentials', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({
            psbtHex: '70736274ff',
            encoding: 'psbt',
            chainId: CHAIN,
            fromAddress: ADDRESS.address,
        });
        mount(
            <TokenWizard walletId="wallet-1" onBack={() => {}} />,
            watcherMessaging({ buildActionPsbtRequest }),
        );

        fireEvent.click(await screen.findByRole('button', { name: /Custom/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(await screen.findByLabelText('Token name (ticker)'), {
            target: { value: 'WATCH' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));

        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalledOnce());
        expect(buildActionPsbtRequest.mock.calls[0][0]).toMatchObject({
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK: 'WATCH' } },
        });
        expect(await screen.findByRole('heading', { name: /unsigned transaction/i })).toBeTruthy();
        expect(screen.queryByLabelText('Password')).toBeNull();
    });
});
