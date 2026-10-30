// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pause token checks the wake block again at Approve and refuses one that has
// passed while the confirm page was open. The form names the cause and the next
// step, rather than "Something went wrong", so the user picks a new duration
// instead of approving the same pause again.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'addr-1',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Pause token wake block at Approve', () => {
    it('names the passed wake block when Approve refuses it', async () => {
        const getIndexerWatermark = vi.fn().mockResolvedValue({ watermark: 100 });
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getIndexerWatermark,
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'GATE', creator: OWNER.address, locks: {} }),
            composeForConfirm: vi.fn().mockResolvedValue({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 }),
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
            sleepState: vi.fn().mockResolvedValue({ resumeBlock: null }),
            sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
        };
        const messaging = new Proxy(target, {
            get(t, prop) {
                return prop in t ? t[prop] : vi.fn().mockResolvedValue({});
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="w" mode="tick" initialChainId={CHAIN} initialTick="GATE" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText('GATE is currently active (not paused).');
        fireEvent.change(screen.getByLabelText('Duration (blocks)'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pause token' }));
        const approve = await screen.findByRole('button', { name: 'Approve' });
        getIndexerWatermark.mockResolvedValue({ watermark: 110 });
        await waitFor(() => expect(approve).toBeEnabled());
        await act(async () => { fireEvent.click(approve); });

        expect(await screen.findByText(
            'Wake block 105 has passed. Go back and choose a new duration. Nothing was signed.',
        )).toBeInTheDocument();
        expect(target.sleepAction).not.toHaveBeenCalled();
    });
});
