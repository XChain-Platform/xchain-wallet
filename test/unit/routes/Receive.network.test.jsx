// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Receive reads two network answers it must not take on faith. An address
// history it cannot read says nothing about whether the address is used, so
// Receive never offers that address as unused. A hardware verify reply counts
// as confirmed only when the device address it carries is the address on
// screen; a reply naming any other address reads as a mismatch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

// jsdom has no canvas, so a fixed PNG data URL stands in for the QR encoder.
vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

const OLDER = {
    id: 'a-older',
    address: 'bcrt1qolderunknown',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/1'/0'/0/4",
    source: 'hd',
    label: 'Older deposits',
};
const NEWEST = {
    id: 'a-newest',
    address: 'bcrt1qnewestused',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/1'/0'/0/5",
    source: 'hd',
    label: 'Newest deposits',
};
const HW_ADDRESS = {
    id: 'a-hw',
    address: 'bcrt1qtrezorshown',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'trezor',
    signerId: 'signer-trezor',
    label: 'Trezor deposits',
};

function renderReceive(overrides = {}) {
    const messaging = {
        getSettings: async () => REGTEST_SETTINGS,
        getWalletBalances: async () => ({}),
        ...overrides,
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="w1" accountId="acct-1" />
        </MessagingProvider>,
    );
}

let consoleError;
beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    cleanup();
    consoleError.mockRestore();
});

describe('Receive address history that cannot be read', () => {
    it.each([
        ['a body that does not parse', () => '<html>502 Bad Gateway</html>'],
        ['a 500 error body', () => ({ status: 500, error: 'Internal Server Error' })],
        ['an empty object', () => ({})],
        ['a rejected request', () => { throw new Error('HTTP 500'); }],
    ])('never offers an address as unused after %s', async (_label, unreadable) => {
        const getAddressHistory = vi.fn(async ({ address }) => {
            if (address === NEWEST.address) return [{ action_index: 1 }];
            return unreadable();
        });
        renderReceive({
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [OLDER, NEWEST] }),
            getNewestAddress: async () => NEWEST,
            getAddressHistory,
        });

        await waitFor(() => expect(screen.getByDisplayValue(NEWEST.address)).toBeInTheDocument());
        await waitFor(() => expect(getAddressHistory).toHaveBeenCalledTimes(2));
        // Let the settled history pass apply its pick before reading the screen.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        expect(screen.getByDisplayValue(NEWEST.address)).toBeInTheDocument();
        expect(screen.queryByDisplayValue(OLDER.address)).toBeNull();
    });

    it('still offers an address whose history reads as empty', async () => {
        const getAddressHistory = vi.fn(async ({ address }) => (
            address === NEWEST.address ? [{ action_index: 1 }] : { data: [] }
        ));
        renderReceive({
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [OLDER, NEWEST] }),
            getNewestAddress: async () => NEWEST,
            getAddressHistory,
        });

        await waitFor(() => expect(screen.getByDisplayValue(OLDER.address)).toBeInTheDocument());
    });
});

describe('Receive hardware verify reply', () => {
    function renderHw(verifyReply) {
        const verifyReceiveAddress = vi.fn(async () => verifyReply);
        renderReceive({
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [HW_ADDRESS] }),
            getNewestAddress: async () => HW_ADDRESS,
            verifyReceiveAddress,
        });
        return verifyReceiveAddress;
    }

    it('reads a confirmed reply naming another address as a mismatch', async () => {
        const verifyReceiveAddress = renderHw({
            confirmed: true,
            deviceAddress: 'bcrt1qsomeoneelse',
            expectedAddress: 'bcrt1qsomeoneelse',
            path: HW_ADDRESS.derivationPath,
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Verify on your Trezor' }));

        await waitFor(() => expect(verifyReceiveAddress).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/showed a different address/)).toBeInTheDocument();
        expect(screen.queryByText(/Address verified on your/)).toBeNull();
    });

    it('reads a confirmed reply with no device address as a mismatch', async () => {
        renderHw({ confirmed: true });

        fireEvent.click(await screen.findByRole('button', { name: 'Verify on your Trezor' }));

        expect(await screen.findByText(/showed a different address/)).toBeInTheDocument();
        expect(screen.queryByText(/Address verified on your/)).toBeNull();
    });

    it('confirms a reply whose device address is the address on screen', async () => {
        renderHw({
            confirmed: true,
            deviceAddress: HW_ADDRESS.address,
            expectedAddress: HW_ADDRESS.address,
            path: HW_ADDRESS.derivationPath,
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Verify on your Trezor' }));

        expect(await screen.findByText(/Address verified on your/)).toBeInTheDocument();
        expect(screen.queryByText(/showed a different address/)).toBeNull();
    });
});
