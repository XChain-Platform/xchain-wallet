// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Review sits below a long form and its refusal notice sits at the top, so a
// refused Review moves focus to the notice area and scrolls it into view, as
// the Send form's error summary does.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-a', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

function messagingStub() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS], 'dogecoin-mainnet': [{ ...ADDRESS, id: 'doge-a', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx' }] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    return new Proxy(base, {
        get: (t, p) => (p in t ? t[p] : vi.fn().mockResolvedValue(null)),
    });
}

afterEach(() => { cleanup(); });

describe.each([
    ['SwapForm', (props) => <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} {...props} />],
    ['CrossChainSwapForm', (props) => <CrossChainSwapForm walletId="w" onBack={() => {}} {...props} />],
])('%s review refusal', (_name, makeForm) => {
    it('focuses the notice area and scrolls it into view', async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        render(
            <MessagingProvider shell="web" messaging={messagingStub()}>
                {makeForm({})}
            </MessagingProvider>,
        );
        const review = await screen.findByRole('button', { name: 'Review' });
        review.focus();
        await waitFor(() => expect(review).toBeEnabled());
        fireEvent.click(review);
        await waitFor(() => {
            const area = document.querySelector('[data-form-status]');
            expect(area).not.toBeNull();
            expect(area.textContent).toMatch(/Enter the give and get|Pick a source/);
            expect(document.activeElement).toBe(area);
        });
        expect(scroll).toHaveBeenCalled();
    });
});
