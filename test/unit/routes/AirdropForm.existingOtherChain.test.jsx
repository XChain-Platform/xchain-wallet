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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { selectOption } from '../../helpers/selectOption.js';
import { existingListRowText } from '../../../packages/core/src/shared/utils/existingListRowText.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LITECOIN = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const LITECOIN_TWO = 'ltc1qqtte56w7s7gst5evtgc64p0vczch7g574fawyk';
const TOKEN = 'DROP';
const ADDRESS = {
    id: 'addr-btc', address: SOURCE, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1',
};

function mount(row) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: TOKEN, divisibility: 0, locks: {} }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([row]),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AirdropForm walletId="wallet-1" initialChainId={CHAIN} initialTick={TOKEN} onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function pickExisting(list) {
    const row = { action_index: '2700', block_index: 10, status: 'valid', type: '2', source: SOURCE, list };
    mount(row);
    selectOption(await screen.findByLabelText(/^Airdrop to/), 'existing');
    fireEvent.click(await screen.findByRole('button', { name: /^List:/ }));
    fireEvent.click(await screen.findByRole('button', { name: existingListRowText(row) }));
}

async function reviewAirdrop(list) {
    await pickExisting(list);
    fireEvent.change(await screen.findByLabelText(/^Per-recipient amount/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Airdrop' }));
    return screen.findByTestId('confirm-modal');
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

describe('AirdropForm existing address list with another coin\'s members', () => {
    it('shows one calm singular line on Confirm, not on the form', async () => {
        await pickExisting([SOURCE, LITECOIN]);
        await screen.findByText(/2 addresses on this list/);
        expect(screen.queryByText(/another coin(?: or)? network/)).toBeNull();

        fireEvent.change(screen.getByLabelText(/^Per-recipient amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Airdrop' }));

        const notice = await screen.findByTestId('confirm-summary-notice');
        expect(notice).toHaveTextContent("Before you approve: 1 address on this list belongs to another coin network, so the airdrop can't deliver to it.");
        expect(notice).toHaveAttribute('role', 'note');
        expect(notice).toHaveAttribute('data-tone', 'info');
        expect(notice.closest('[data-testid="confirm-facts"]')).toBeNull();
        expect(notice.closest('[role="alert"], [data-variant="warning"], [data-variant="error"]')).toBeNull();
        expect(screen.queryByTestId('confirm-action-warning')).toBeNull();
        expect(document.body.textContent).not.toMatch(/charges|fees|still pays|in total/i);
    });

    it('uses plural grammar and the right count on Confirm', async () => {
        await reviewAirdrop([SOURCE, LITECOIN, LITECOIN_TWO]);
        expect(screen.getByTestId('confirm-summary-notice')).toHaveTextContent(
            "Before you approve: 2 addresses on this list belong to another coin network, so the airdrop can't deliver to them.",
        );
    });

    it('stays silent when every member is for the active chain', async () => {
        await pickExisting([SOURCE]);
        await screen.findByText(/1 address on this list/);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.queryByText(/another coin(?: or)? network/)).toBeNull();
    });
});
