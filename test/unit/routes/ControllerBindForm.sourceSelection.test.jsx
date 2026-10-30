// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';

const walletMode = vi.hoisted(() => ({ value: 'full' }));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({
        walletMode: walletMode.value,
        isFullMode: walletMode.value === 'full',
        isWatcherMode: walletMode.value === 'watcher',
        isSignerMode: walletMode.value === 'signer',
    }),
}));

const BITCOIN = 'bitcoin-mainnet';
const LITECOIN = 'litecoin-mainnet';
const NO_SOURCE = 'No address on this network to sign from. Use Receive to generate one first.';

const importedAddress = {
    id: 'imported-1',
    address: 'bc1qimported',
    source: 'imported-wif',
};

const hdAddress = {
    id: 'hd-1',
    address: 'ltc1qeligible',
    publicKey: '02ab',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
};

function messagingFor(addressesByChain, options = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addressesByChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: walletMode.value,
            activeNetwork: 'mainnet',
            lastUsedChain: { mainnet: options.lastUsedChain || BITCOIN },
        }),
        getControllerActionClasses: vi.fn().mockResolvedValue({ actionClasses: ['transfer'] }),
        getSignerStatus: options.getSignerStatus || vi.fn().mockResolvedValue({ status: 'available' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        buildControllerBindParams: vi.fn().mockResolvedValue({ action: 'ADDRESS', params: {} }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(addressesByChain, { initialChainId, ...options } = {}) {
    const messaging = messagingFor(addressesByChain, options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ControllerBindForm
                walletId="wallet-1"
                chainId={initialChainId}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => { walletMode.value = 'full'; });
afterEach(() => cleanup());

describe('ControllerBindForm source selection', () => {
    it('keeps Network available when the chosen chain has no eligible address', async () => {
        mount({
            [BITCOIN]: [importedAddress],
            [LITECOIN]: [hdAddress],
        }, { initialChainId: BITCOIN });

        expect(await screen.findByText(NO_SOURCE)).toBeTruthy();
        const network = screen.getByRole('button', { name: 'Network: Bitcoin' });
        expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled();

        fireEvent.click(network);
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));

        expect(await screen.findByRole('button', { name: 'Network: Litecoin' })).toBeTruthy();
        expect(await screen.findByDisplayValue(hdAddress.address)).toBeTruthy();
        expect(screen.queryByText(NO_SOURCE)).toBeNull();
        expect(screen.getByRole('button', { name: 'Bind' })).toBeEnabled();
    });

    it('skips a default chain that has no eligible address', async () => {
        mount({
            [BITCOIN]: [importedAddress],
            [LITECOIN]: [hdAddress],
        });

        expect(await screen.findByRole('button', { name: 'Network: Litecoin' })).toBeTruthy();
        expect(await screen.findByDisplayValue(hdAddress.address)).toBeTruthy();
        expect(screen.queryByText(NO_SOURCE)).toBeNull();
    });

    it('shows a hardware-only wallet with device-gated submit and its reason', async () => {
        const hardwareAddress = {
            ...hdAddress,
            id: 'ledger-1',
            source: 'ledger',
            signerId: 'signer-1',
        };
        const messaging = mount({ [LITECOIN]: [hardwareAddress] }, {
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'disconnected' }),
        });

        const guard = await screen.findByLabelText('Guard contract');
        expect(await screen.findByText(/Device not detected/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled();
        expect(screen.queryByText(NO_SOURCE)).toBeNull();
        fireEvent.submit(guard.closest('form'));
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
    });

    it('shows a watch-only account with disabled submit and its signing reason', async () => {
        const watchAddress = {
            ...hdAddress,
            id: 'watch-1',
            source: 'watch-only',
        };
        const messaging = mount({ [LITECOIN]: [watchAddress] });

        const guard = await screen.findByLabelText('Guard contract');
        expect(screen.getByText('This watch-only account cannot sign.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled();
        expect(screen.queryByText(NO_SOURCE)).toBeNull();
        fireEvent.submit(guard.closest('form'));
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
    });
});
