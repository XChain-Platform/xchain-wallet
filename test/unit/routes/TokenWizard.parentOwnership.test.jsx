// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The subtoken wizard looks the parent up before review. The chain refuses a
// child whose parent is missing or owned by another address, and it does so
// after the fee is spent, so the wallet refuses first. An explorer that cannot
// answer is a refusal, never a pass.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const OWNER = 'bc1qownerownerownerownerownerownerownerow';
const STRANGER = 'bc1qstrangerstrangerstrangerstrangerstrang';

const ADDRESSES = {
    'bitcoin-mainnet': [{
        id: 'addr-0',
        address: OWNER,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

async function review(getTokenInfo) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getTokenInfo,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenWizard walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByText('Subtoken'));
    await screen.findByLabelText('Fee paid by');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('Parent ticker'), { target: { value: 'PARENT' } });
    fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review token' }));
    return messaging;
}

describe('TokenWizard subtoken parent lookup', () => {
    afterEach(cleanup);

    it('reaches review when this wallet owns the existing parent', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ creator: OWNER });
        await review(getTokenInfo);
        expect(await screen.findByRole('button', { name: /Continue to confirmation/ })).toBeTruthy();
        expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PARENT' }));
    });

    it('refuses a parent that the explorer does not know', async () => {
        await review(vi.fn().mockResolvedValue({ creator: null }));
        expect(await screen.findByText(/PARENT could not be confirmed as a token this wallet owns/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Continue to confirmation/ })).toBeNull();
    });

    it('refuses a parent owned by another address', async () => {
        await review(vi.fn().mockResolvedValue({ creator: STRANGER }));
        expect(await screen.findByText(/This wallet does not own PARENT/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Continue to confirmation/ })).toBeNull();
    });

    it('refuses when the explorer cannot answer', async () => {
        await review(vi.fn().mockRejectedValue(new Error('explorer 500')));
        expect(await screen.findByText(/PARENT could not be confirmed as a token this wallet owns/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Continue to confirmation/ })).toBeNull();
    });
});
