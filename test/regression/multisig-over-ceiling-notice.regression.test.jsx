// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a stored multisig past its scheme's cosigner ceiling.
//
//   [P0] 2026-10-24: A vault holding a 17-key SegWit config shows its
//        receive address and QR although funds sent there can never be spent,
//        and a 16-key Classic config is skipped without a word. Both say so
//        in a page notice and show no address.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { listMultisigReceiveAddresses } from '../../packages/core/src/flows/multisigAddress.js';
import { exceedsMultisigCeiling } from '../../packages/core/src/schemas/multisigConfig.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { AddressList } from '../../packages/core/src/shared/routes/AddressList.jsx';

const CHAIN = 'bitcoin-regtest';
const SEGWIT_ADDRESS = 'bcrt1qsegwitmultisigaddressfortesting0000000000000000000000';
const NOTICE = /more cosigners than its address type supports, so funds sent to it can.t be spent/i;

function config(scheme, count) {
    return {
        id: `cfg-${scheme}-${count}`,
        scheme,
        threshold: 2,
        scriptTemplate: 'multi:2:aa',
        cosigners: Array.from({ length: count }, (_, i) => ({ name: `Key ${i + 1}` })),
    };
}

// The SDK derives whatever it is given for SegWit and refuses a Classic script
// past the redeem script limit, as the real one does.
const sdkRegistry = {
    get: () => ({
        deriveMultisigAddress: ({ scheme }) => {
            if (scheme === 'p2sh-multisig') throw new Error('redeem script too large');
            return { address: SEGWIT_ADDRESS, scheme };
        },
        validateAddress: () => ({ valid: true, type: 'p2wsh' }),
    }),
};

function messagingFor(multisigConfig) {
    const vault = { wallets: { get: async () => ({ id: 'w-1', multisigs: [multisigConfig] }) } };
    return {
        getAddressesByChain: vi.fn(async () => ({
            [CHAIN]: [{ id: 'a-1', address: 'bcrt1qplainaddress', label: '', chain: CHAIN }],
        })),
        getSettings: vi.fn(async () => ({})),
        getNewestAddress: vi.fn(async () => ({ id: 'a-1', address: 'bcrt1qplainaddress', label: '' })),
        listMultisigReceiveAddresses: vi.fn((req) => listMultisigReceiveAddresses({ ...req, vault, sdkRegistry })),
    };
}

async function renderWith(multisigConfig, ui) {
    await act(async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingFor(multisigConfig)}>
                {ui}
            </MessagingProvider>,
        );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

afterEach(() => cleanup());

const receive = () => <Receive walletId="w-1" accountId="acc-1" prefill={{ chainId: CHAIN }} onBack={() => {}} />;
const addressList = () => <AddressList walletId="w-1" accountId="acc-1" onBack={() => {}} />;

describe('regression/multisig-over-ceiling-notice', () => {
    it('[REGRESSION P0] names the configs past the ceiling', () => {
        expect(exceedsMultisigCeiling('p2wsh-multisig', 17)).toBe(true);
        expect(exceedsMultisigCeiling('p2wsh-multisig', 16)).toBe(false);
        expect(exceedsMultisigCeiling('p2sh-multisig', 16)).toBe(true);
        expect(exceedsMultisigCeiling('p2sh-multisig', 15)).toBe(false);
        expect(exceedsMultisigCeiling('taproot-musig2', 20)).toBe(false);
    });

    it.each([
        ['p2wsh-multisig', 17],
        ['p2sh-multisig', 16],
    ])('[REGRESSION P0] Receive shows the notice and no address for %s with %i keys', async (scheme, count) => {
        await renderWith(config(scheme, count), receive());
        expect(screen.getByText(NOTICE)).toBeTruthy();
        expect(screen.queryByText(SEGWIT_ADDRESS)).toBeNull();
        expect(screen.queryByRole('group', { name: 'Multisig receive address' })).toBeNull();
        expect(screen.queryByRole('img', { name: /Multisig QR code/i })).toBeNull();
    });

    it('[REGRESSION P0] Receive renders a 16-key SegWit config normally', async () => {
        await renderWith(config('p2wsh-multisig', 16), receive());
        expect(screen.queryByText(NOTICE)).toBeNull();
        expect(screen.getByRole('group', { name: 'Multisig receive address' })).toBeTruthy();
        expect(screen.getByText(SEGWIT_ADDRESS)).toBeTruthy();
    });

    it.each([
        ['p2wsh-multisig', 17],
        ['p2sh-multisig', 16],
    ])('[REGRESSION P0] the detail screen shows the notice and no address for %s with %i keys', async (scheme, count) => {
        await renderWith(config(scheme, count), addressList());
        await act(async () => { fireEvent.click(screen.getByText('Multisig receive')); });
        expect(screen.getByText(NOTICE)).toBeTruthy();
        expect(screen.queryByText(SEGWIT_ADDRESS)).toBeNull();
        expect(screen.queryByRole('button', { name: /Copy wallet address/i })).toBeNull();
    });

    it('[REGRESSION P0] the detail screen of a 16-key SegWit config carries its address and no notice', async () => {
        await renderWith(config('p2wsh-multisig', 16), addressList());
        await act(async () => { fireEvent.click(screen.getAllByText('Multisig receive')[0]); });
        expect(screen.queryByText(NOTICE)).toBeNull();
        expect(screen.getAllByText(SEGWIT_ADDRESS).length).toBeGreaterThan(0);
    });
});
